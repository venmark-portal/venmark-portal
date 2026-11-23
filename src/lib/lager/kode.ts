// Koder der kommer ind gennem scannefeltet.
//
// Vores EGEN hylde-label bærer to QR-koder, og de to har hver sin modtager:
//
//   Vare-QR'en     er varenummeret — den slås op i BC som enhver anden stregkode.
//   Kanban-QR'en   er en ADRESSE, /k/<varenr>, med teksten "TOM HYLDE? SCAN HER".
//                  Den er en adresse med vilje: den der tømmer hylden går sjældent
//                  med en håndterminal, så koden skal også virke med et almindeligt
//                  telefonkamera. Se [[project_kanban_tomme_hylder]].
//
// Problemet var, at labelen inviterer til at blive scannet — og når man så scannede
// den MED håndterminalen, blev hele adressen sendt til BC, som svarede "ukendt kode".
// Det er vores egen kode på vores egen label; den må ikke afvises. Står man med
// labelen i hånden og scanner den i lager-appen, mener man varen.
//
// Derfor pilles varenummeret ud her — ét sted, før opslaget, så alle skærme i
// lager-appen (labels, optælling, bestilling, hovedscanningen) opfører sig ens.

/**
 * `/k/79553`, `portal.venmark.dk/k/79553`, `https://portal.venmark.dk/k/79553` —
 * alle tre former, fordi en scanner eller et kamera kan aflevere adressen både med
 * og uden skema. Sti-delen SKAL være præcis `/k/<kode>`, så en vilkårlig anden
 * adresse ikke bliver lavet om til et varenummer.
 */
const KANBAN_ADRESSE = /^(?:https?:\/\/)?[^\s/]*\/k\/([^/?#]+)\/?$/i

/**
 * Koden som den skal slås op i BC.
 *
 * Gør to ting, og kun to:
 *   1. Scanneren med US-tastatur sender '-' som '+'. Se [[feedback_scanner_keyboard_layout]].
 *   2. Vores egen kanban-adresse reduceres til varenummeret.
 *
 * Alt andet går uændret videre. Feltet skal ikke gætte på, hvad en fremmed kode
 * "nok betyder" — det er BC's opslag, der afgør, om en kode findes.
 */
export function rensScanKode(raa: string): string {
  // Rækkefølgen betyder ikke noget for adressen (den indeholder aldrig '+'), men
  // tastaturfejlen rettes først, så en håndtastet kode behandles som en scannet.
  const kode = raa.trim().replace(/\+/g, '-')
  const fund = KANBAN_ADRESSE.exec(kode)
  if (!fund) return kode
  try {
    return decodeURIComponent(fund[1])
  } catch {
    // Ødelagt %-kodning: så er den rå tekst et bedre gæt end ingenting.
    return fund[1]
  }
}
