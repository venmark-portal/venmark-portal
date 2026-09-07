# Giver denne Claude-/VS Code-session sit eget arbejdstræ, så den ikke deler
# checkout med de andre sessioner på maskinen.
#
#   .\nyt-worktree.ps1 skaerme staging     -> ..\venmark-portal-skaerme på staging
#   .\nyt-worktree.ps1 fragt               -> ..\venmark-portal-fragt på ny branch fra main
#
# Worktrees deler samme .git (samme commits, samme remote), men har hvert sit
# arbejdstræ og sin egen branch — så et checkout i én session rører ikke de andre.

param(
  [Parameter(Mandatory = $true)][string]$Navn,
  [string]$Branch
)

$ErrorActionPreference = 'Stop'

$hoved = Split-Path -Parent $MyInvocation.MyCommand.Path
$sti   = Join-Path (Split-Path -Parent $hoved) "venmark-portal-$Navn"

if (Test-Path $sti) {
  Write-Host "Findes allerede: $sti" -ForegroundColor Yellow
  exit 0
}

# Findes branchen? Ellers opret den fra main.
if (-not $Branch) { $Branch = "arbejde/$Navn" }
$findes = git -C $hoved rev-parse --verify --quiet "refs/heads/$Branch"

if ($findes) {
  git -C $hoved worktree add $sti $Branch
} else {
  Write-Host "Branch '$Branch' findes ikke — opretter den fra main." -ForegroundColor Cyan
  git -C $hoved worktree add -b $Branch $sti main
}

# Del node_modules med hovedklonen — sparer et ~500 MB npm install pr. worktree.
$nm = Join-Path $sti 'node_modules'
if (-not (Test-Path $nm)) {
  New-Item -ItemType Junction -Path $nm -Target (Join-Path $hoved 'node_modules') | Out-Null
}

Write-Host ""
Write-Host "Klar: $sti  (branch $Branch)" -ForegroundColor Green
Write-Host "Åbn den mappe i VS Code — så arbejder denne session for sig selv."
Write-Host "Ryd op bagefter med:  git worktree remove `"$sti`""
