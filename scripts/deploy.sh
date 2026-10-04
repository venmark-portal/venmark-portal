#!/bin/bash
# Deploy af portalen på produktionsserveren.
#
#   ssh root@204.168.191.215 "/var/www/venmark/scripts/deploy.sh"
#
# Hele pointen: den kørende app rører vi ikke før der ligger et FÆRDIGT byg.
# Før byggede vi direkte i .next mens serveren læste derfra — portalen svarede 502
# gennem hele byggeperioden, og blev liggende sådan hvis byggeriet fejlede undervejs.
# Nu bygges der til .next-new, og først når det er lykkedes skiftes mappen på plads.
# Svarer portalen ikke bagefter, rulles der automatisk tilbage til forrige byg.
set -euo pipefail

APP=/var/www/venmark
PORT=3000
cd "$APP"

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

log "Henter kode"
FOER=$(git rev-parse HEAD)
git fetch --quiet origin
git reset --quiet --hard origin/main
git --no-pager log --oneline -1

# Afhængigheder installeres kun når låsefilen faktisk har ændret sig. IKKE --omit=dev:
# det prunede typescript, som byggeriet har brug for.
if ! git diff --quiet "$FOER" HEAD -- package-lock.json package.json; then
  log "package-lock.json ændret → npm install"
  npm install --no-audit --no-fund
fi

log "Bygger til .next-new (den kørende app er urørt)"
rm -rf .next-new
NEXT_DIST_DIR=.next-new npm run build

# Et byg uden disse to filer er ikke brugbart — det var præcis sådan 502'erne så ud.
for f in .next-new/prerender-manifest.json .next-new/server/pages-manifest.json; do
  [ -f "$f" ] || { echo "FEJL: byggeriet mangler $f — skifter IKKE over"; exit 1; }
done

log "Skifter over"
rm -rf .next-forrige
if [ -d .next ]; then mv .next .next-forrige; fi
mv .next-new .next
pm2 restart venmark >/dev/null

log "Tjekker at portalen svarer"
kode=000
for _ in $(seq 1 20); do
  kode=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/portal/login" || echo 000)
  [ "$kode" = "200" ] && break
  sleep 2
done

if [ "$kode" != "200" ]; then
  log "Portalen svarer $kode — ruller tilbage til forrige byg"
  if [ -d .next-forrige ]; then
    rm -rf .next
    mv .next-forrige .next
    pm2 restart venmark >/dev/null
    sleep 5
    echo "Rullet tilbage. Status nu: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/portal/login" || echo 000)"
  else
    echo "Intet forrige byg at rulle tilbage til."
  fi
  exit 1
fi

# Tidszonen er kritisk: uden den regner alle bestillingsfrister forkert (se src/lib/dateUtils.ts).
TZ_NU=$(tr '\0' '\n' < "/proc/$(pm2 pid venmark)/environ" | grep '^TZ=' || echo 'TZ=MANGLER')
log "Klar — portalen svarer $kode · $TZ_NU"
