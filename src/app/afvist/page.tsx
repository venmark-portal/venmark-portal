// AFVIST-splash: åbnes af BC (Hyperlink) i et nyt browservindue når en sælger sætter en
// afvist vare ind for 1./4./7. gang samme dag. ?n=1|2|3 vælger en eskalerende tekst.
// Bevidst dramatisk (rød/sort, kæmpe "AFVIST") — "markedsføring" så sælgeren forstår alvoren.

export const dynamic = 'force-dynamic'

const TEKSTER: Record<string, { over: string; under: string }> = {
  '1': {
    over: 'Tjek om det er en Claude-fejl — eller om der er noget om snakken.',
    under: 'Der er ikke dækning på varen lige nu. Er tallet forkert, så sig til. Ellers: sælg ikke mere end vi har.',
  },
  '2': {
    over: '4. gang i dag.',
    under: 'Enten spøger systemet — eller også sælger du mere end vi har hjemme. Ring til indkøb/produktion FØR du lover det.',
  },
  '3': {
    over: '7. gang i dag?! Stop op.',
    under: 'Du oversælger. Det koster os penge, tid og kunder. Ring til indkøb/produktion NU og få styr på dækningen.',
  },
}

export default function AfvistPage({ searchParams }: { searchParams: { n?: string } }) {
  const n = searchParams?.n && TEKSTER[searchParams.n] ? searchParams.n : '1'
  const t = TEKSTER[n]

  return (
    <div
      style={{
        minHeight: '100vh',
        margin: 0,
        background: '#0a0a0a',
        color: '#ff2b2b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '4vh 5vw',
        fontFamily: 'Arial Black, Arial, sans-serif',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          fontSize: 'min(28vw, 50vh)',
          lineHeight: 0.9,
          fontWeight: 900,
          letterSpacing: '0.02em',
          textShadow: '0 0 40px rgba(255,43,43,0.5)',
        }}
      >
        AFVIST
      </div>
      <div
        style={{
          marginTop: '4vh',
          maxWidth: '900px',
          color: '#fff',
          fontSize: 'clamp(20px, 3.2vw, 40px)',
          fontWeight: 800,
          lineHeight: 1.15,
        }}
      >
        {t.over}
      </div>
      <div
        style={{
          marginTop: '2.5vh',
          maxWidth: '820px',
          color: '#d0d0d0',
          fontSize: 'clamp(15px, 2vw, 24px)',
          fontWeight: 500,
          lineHeight: 1.35,
        }}
      >
        {t.under}
      </div>
    </div>
  )
}
