import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDeadlineForDelivery, getDeadlineForMethodDelivery, getEffectiveDateForMethodDelivery, earliestDeliveryForItem, aabnTilFrist } from '@/lib/dateUtils'
import { sendOrderNotification, sendBCVerificationAlert } from '@/lib/email'
import { createBCSalesOrder, flagBeskedUlaest, getPortalShipmentMethods, getPortalCalendarDays, getItemCutoffs, getCustomerLocationCode, getItemAvailabilities, getCartCoverage, addLinesToBCOrder } from '@/lib/businesscentral'
import { findAabenOrdre } from '@/lib/aabenOrdre'
import { kbhOpsplit } from '@/lib/kbhLevering'
import { revalidatePath } from 'next/cache'
import { getActiveCustomerNo, getParentCustomerNo, isCustomerAllowed } from '@/lib/activeCustomer'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { makeT, localeOf } from '@/lib/i18n/portal/lang'
import { ordrerApiDict } from '@/lib/i18n/portal/dict/ordrer-api'

// Coverage-kaldet til BC (afgang-dækkede linjer) kan tage >10s ved tunge producerede varer —
// samme grund som coverage/route. Uden dette kunne et serverless-timeout afbryde ordren.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  // Kundesynlige fejltekster på kundens sprog; console-logs og admin-tekster forbliver danske.
  const lang   = await getPortalLang()
  const t      = makeT(ordrerApiDict, lang)
  const locale = localeOf(lang)
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: t('ikkeLoggetInd') }, { status: 401 })
  }

  const userId = (session.user as any)?.id as string

  // "Bestil på vegne af": ordren oprettes på den AKTIVE kunde (valgt butik).
  // Gen-validér ALTID server-side mod BC-adgangslisten — stol aldrig på sessionen alene.
  const parentNo         = getParentCustomerNo(session)
  const activeCustomerNo = getActiveCustomerNo(session)
  if (!(await isCustomerAllowed(parentNo, activeCustomerNo))) {
    return NextResponse.json({ error: t('ingenAdgangButik') }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { deliveryDate: deliveryDateStr, notes, lines, shipmentMethodCode, poNumber, driverNote } = body

    if (!deliveryDateStr || !lines?.length) {
      return NextResponse.json({ error: t('manglerDatoLinjer') }, { status: 400 })
    }

    const deliveryDate = new Date(deliveryDateStr)

    // Fælles kalender + leveringsmetoder + varefrister — bruges til BÅDE deadline- og
    // bestillingsfrist-tjek. (Hentes altid, så frist-håndhævelsen også virker uden metode.)
    const toDate90 = new Date(); toDate90.setDate(toDate90.getDate() + 90)
    const today8601 = new Date().toISOString().split('T')[0]
    const [allMethods, calendarDays, itemCutoffs] = await Promise.all([
      getPortalShipmentMethods().catch(() => []),
      getPortalCalendarDays(today8601, toDate90.toISOString().split('T')[0]).catch(() => []),
      getItemCutoffs().catch(() => new Map()),
    ])

    // Beregn deadline med leveringsmetode-logik hvis muligt, ellers simpel fallback
    const method = shipmentMethodCode ? allMethods.find(m => m.code === shipmentMethodCode) : undefined
    const deadline: Date = method
      ? getDeadlineForMethodDelivery(deliveryDate, method, calendarDays)
      : getDeadlineForDelivery(deliveryDate)

    // Tjek deadline
    if (new Date() > deadline) {
      return NextResponse.json(
        { error: t('deadlinePasseret', { tid: deadline.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) },
        { status: 422 }
      )
    }

    // ── Frist- + antals-håndhævelse (server-backstop for UI) ────────────────────────
    // Matcher portalens fristFloor/rowMaxQty:
    //   • Frist-vare til FORWARD-dato (≥ gulv) → fri, ubegrænset (skaffes frisk).
    //   • Frist-vare til NÆR dato UDEN lager → afvis (kan ikke skaffes i tide).
    //   • Streng vare fra lager (nær dato, knapt <50 kg) → maks disponibelt.
    const holidaySet = new Set<string>()
    for (const d of calendarDays) {
      if ((!d.shipmentMethodCode || d.shipmentMethodCode === '') && d.dayType === 1) holidaySet.add(d.date)
    }
    const custLoc    = await getCustomerLocationCode(activeCustomerNo).catch(() => '')
    const avails     = await getItemAvailabilities(custLoc).catch(() => new Map())
    const ddMidnight = new Date(deliveryDate); ddMidnight.setHours(0, 0, 0, 0)
    const dStr       = deliveryDate.toISOString().split('T')[0]
    // Dansk dato. toISOString gav UTC-datoen, og den er en dag bagud mellem midnat og
    // kl. 02 dansk tid — netop når en natlig prisrunde skal sammenlignes med "i dag".
    const todayStr   = new Date().toLocaleDateString('en-CA')
    const tooEarly: string[] = []
    const overCap:  string[] = []
    // Samme afvisning, men i maskinlæsbar form. Uden den kunne portalen kun vise kunden en
    // sætning og lade hende selv finde linjen og regne baglæns; nu kan den sætte antallet
    // ned til det der faktisk er, og lade hende sende igen.
    const lofter: { itemNo: string; navn: string; maks: number }[] = []
    // Linjer der KUN er dækket af en kommende afgang (købsordre/montage) — ikke af lager, ikke af
    // frist-gulvet. De har en ENDELIG mængde på vej, så loftet skal komme fra BC's coverage.
    const afgangLines: { itemNo: string; name: string; qty: number }[] = []
    for (const l of lines) {
      const a = avails.get(l.bcItemNumber)
      if (!a) continue   // ingen disponibilitets-data → spring over (fail open; UI gater primært)
      const c    = itemCutoffs.get(l.bcItemNumber)
      const disp = a.disponibelt

      // Frist-vares forward-gulv
      let floor: Date | null = null
      if (c && c.cutoffWeekday > 0) {
        floor = earliestDeliveryForItem(c.cutoffWeekday, c.cutoffHour, new Date(), c.leadDays ?? 0, holidaySet)
        floor.setHours(0, 0, 0, 0)
      }
      // Med leveringstid er gulvet "varen hjemme" → sammenlign med den EFFEKTIVE dato (pak/afsendelse),
      // som klientens fristReachedFor og BC's coverage. Legacy (ingen leveringstid) = leveringsdato.
      let cmpDate = ddMidnight
      if (floor && (c?.leadDays ?? 0) > 0 && method) {
        cmpDate = new Date(getEffectiveDateForMethodDelivery(deliveryDate, method, holidaySet))
        cmpDate.setHours(0, 0, 0, 0)
      }
      const floorForward   = floor ? cmpDate >= floor : false
      // Afsendelses-/pakkedagen (leveringsdato − transit, evt. pak-dagen-før). BC's naesteLevering
      // er den dag varen er HJEMME, så den skal sammenlignes med afsendelsesdagen — ikke
      // leveringsdatoen. Før: levering tirs 27/10 (afgang man 26/10) blev regnet "dækket" af en
      // afgang 27/10 → Kulmule filet 3 (streng, lager 0) solgt kl. 9.38 til Storms Fisk (W0000117).
      const afsendDag   = method ? getEffectiveDateForMethodDelivery(deliveryDate, method, holidaySet) : deliveryDate
      const afsendStr   = afsendDag.toLocaleDateString('en-CA')
      const coveredByAfgang = !!a.naesteLevering && afsendStr >= a.naesteLevering
      const isForward = floorForward || coveredByAfgang

      // 1. Frist-vare til for tidlig dato UDEN lager OG uden afgang der dækker → afvis.
      //    (En købsordre der ankommer senest leveringsdatoen dækker — spejler klientens isItemAvailable.)
      if (floor && !floorForward && disp <= 0 && !coveredByAfgang) {
        tooEarly.push(t('tidligst', { navn: l.itemName || l.bcItemNumber, dato: floor.toLocaleDateString(locale) }))
        continue
      }
      // 2. Antals-loft: ALLE varetyper cappes ved disponibelt (intet oversalg), UNDTAGET
      //    auktions-fri-bestilling (priser ikke stemplet i dag) + forward-dækkede datoer.
      // Åbn til-vindue (ikke-streng, fx salater): før fristen laves der mere → intet loft (= klientens rowMaxQty).
      if (!a.strengtLager && a.aabnTil) {
        const f = aabnTilFrist(a.aabnTil, deliveryDate, deadline, a.leadDage ?? 0, holidaySet)
        if (f && Date.now() < f.getTime()) continue
      }
      // Samme regel som klientens rowMaxQty — ellers afviser serveren det portalen lige
      // har tilladt. "Priser opdateret i dag" betyder at DAGENS fangst er købt og prissat,
      // og så gælder lageret. Men det siger intet om en senere dags auktion: afsendes der
      // i fremtiden, har vi den auktion til gode, og varen er fri.
      const prisDato    = a.priserOpdateret
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date(a.priserOpdateret))
        : ''
      // Kan vi nå en auktion inden varen skal være klar? Der er ingen auktion lørdag,
      // søndag og helligdage — og om lørdagen er priserne stemplet i fredags, så et tjek
      // på prisstemplet alene gjorde alle auktionsvarer frit bestilbare hele weekenden.
      const afsendWd    = afsendDag.getDay()
      const handelsdag  = afsendWd !== 0 && afsendWd !== 6 && !holidaySet.has(afsendStr)
      const auctionFree = a.auktionsKategori && handelsdag
        && (afsendStr > todayStr || prisDato !== todayStr)
      // Streng vare uden lager og uden afgang der når afsendelsesdagen → kan ikke leveres.
      // Afvises HER, uden at afhænge af BC-coverage-kaldet (som fail-open'er ved fejl/timeout).
      if (a.strengtLager && disp <= 0 && !coveredByAfgang && !floorForward && !auctionFree) {
        tooEarly.push(t('ikkeDaekket', { navn: l.itemName || l.bcItemNumber }))
        continue
      }
      if (!auctionFree && !isForward && disp > 0 && l.quantity > disp) {
        overCap.push(t('maks', { navn: l.itemName || l.bcItemNumber, n: Math.round(disp * 10) / 10 }))
        lofter.push({ itemNo: l.bcItemNumber, navn: l.itemName || l.bcItemNumber, maks: Math.round(disp * 10) / 10 })
      }
      // 3. Dækket KUN af afgang (lager ≤ 0, ikke frist-forward) → loftet = BC coverage (mængden på vej).
      if (!auctionFree && !floorForward && coveredByAfgang && disp <= 0)
        afgangLines.push({ itemNo: l.bcItemNumber, name: l.itemName || l.bcItemNumber, qty: l.quantity })
    }
    // Autoritativt loft fra BC for afgang-dækkede linjer (samme beregning som klientens "Maks X").
    // Fail-open ved BC-fejl/timeout (UI gater primært) — men aldrig ubegrænset når BC svarer.
    if (afgangLines.length) {
      try {
        const cart: Record<string, number> = {}
        for (const l of lines) if (l.bcItemNumber && l.quantity > 0) cart[l.bcItemNumber] = l.quantity
        const cov = await getCartCoverage(activeCustomerNo, custLoc, dStr, shipmentMethodCode || '', afgangLines.map(x => x.itemNo), cart)
        for (const row of cov?.results ?? []) {
          const ln = afgangLines.find(x => x.itemNo === row.itemNo)
          if (!ln || row.unlimited) continue
          if (row.maxQty <= 0) tooEarly.push(t('ikkeDaekket', { navn: ln.name }))
          else if (ln.qty > row.maxQty) {
            overCap.push(t('maks', { navn: ln.name, n: Math.round(row.maxQty * 10) / 10 }))
            lofter.push({ itemNo: ln.itemNo, navn: ln.name, maks: Math.round(row.maxQty * 10) / 10 })
          }
        }
      } catch (e) {
        // Fail open (UI gater primært) — men LOG det: en tavs fejl her lod W0000117 igennem uden spor.
        console.error(`[ordre] coverage-loft fejlede for ${activeCustomerNo} ${dStr} (${afgangLines.map(x => x.itemNo).join(',')}):`,
          e instanceof Error ? e.message : e)
      }
    }
    if (tooEarly.length) {
      return NextResponse.json(
        { error: t('fristIkkeNaaet', { liste: tooEarly.join(', ') }) },
        { status: 422 }
      )
    }
    if (overCap.length) {
      return NextResponse.json(
        { error: t('forStortAntalNy', { liste: overCap.join(', ') }), lofter },
        { status: 422 }
      )
    }

    const customer = await prisma.customer.findUnique({ where: { id: userId } })
    if (!customer) {
      return NextResponse.json({ error: t('kundeIkkeFundet') }, { status: 404 })
    }

    // ── ÉN ORDRE PR. LEVERANCE ───────────────────────────────────────────────
    // Ligger der allerede en åben, upakket ordre til samme dag på samme
    // leveringsform, lægges varerne PÅ den frem for at blive en ordre mere.
    // Tjekket ligger her og ikke kun i browseren: en fane der har stået åben
    // siden i morges ved ikke at kontoret har taget en ordre i telefonen siden.
    // Er ordren pakket, kan den ikke nå at få mere med, og en ny er det rigtige.
    const eksisterende = await findAabenOrdre(activeCustomerNo, dStr, shipmentMethodCode || '')
      .catch(() => null)

    if (eksisterende && !eksisterende.pakket) {
      const { errors } = await addLinesToBCOrder(
        eksisterende.bcOrderId,
        lines.map((l: any) => ({ itemNumber: l.bcItemNumber, quantity: l.quantity, uomCode: l.uom })),
      )
      // Slettes ordren i BC i sekundet mellem opslaget og linjerne (kontoret rydder op), afviser
      // BC ALLE linjer med "No document with the specified ID exists". Så findes den ikke længere
      // → fald igennem og opret en NY ordre nedenfor (Claus: "ellers opret ny ordre").
      const ordreForsvandt = errors.length > 0 && errors.length >= lines.length &&
        errors.every((e: string) => /No document with the specified ID exists/i.test(e))
      if (ordreForsvandt) {
        console.warn('[ordre]', eksisterende.bcOrderNumber, 'forsvandt under afsendelse → opretter ny ordre')
      } else if (errors.length > 0) {
        console.error('[ordre] kunne ikke lægge paa', eksisterende.bcOrderNumber, errors)
        return NextResponse.json(
          { error: t('kunneIkkeLaeggePaaBestilling', { nr: eksisterende.bcOrderNumber, fejl: errors.join(' · ') }) },
          { status: 502 },
        )
      }
      if (!ordreForsvandt) {
        // KBH-levering: varer på lager i København → kundens XVEN-ordre (eksisterende ordre slettes aldrig).
        const kbh = await kbhOpsplit({
          ordreNr: eksisterende.bcOrderNumber, sletTomHoved: false, navne: varenavne(lines),
          portalKunde: await prisma.customer.findUnique({ where: { id: userId }, select: { id: true, name: true, bcCustomerNumber: true } }) ?? undefined,
          kundeNr: activeCustomerNo,
        })
        revalidatePath('/portal/ordrer')
        return NextResponse.json({
          tilfoejet:   true,
          ordreNummer: eksisterende.bcOrderNumber,
          antal:       lines.length,
          ialt:        eksisterende.antalLinjer + lines.length,
          fraPortal:   eksisterende.fraPortal,
          kbh,
        }, { status: 200 })
      }
    }

    // Gem ordre i DB — nye felter (driverNote, poNumber, orderedByName, orderedByEmail)
    // tilføjes via $executeRaw da prisma generate ikke er kørt (DLL-lock workaround)
    const order = await prisma.order.create({
      data: {
        customerId:  userId,
        type:        'ONEOFF',
        status:      'SUBMITTED',
        deliveryDate,
        deadline,
        notes:       notes ?? null,
        submittedAt: new Date(),
        lines: {
          create: lines.map((l: any) => ({
            bcItemNumber: l.bcItemNumber,
            itemName:     l.itemName,
            quantity:     l.quantity,
            uom:          l.uom,
            unitPrice:    l.unitPrice ?? 0,
            status:       'PENDING',
          })),
        },
      },
      include: { lines: true },
    })

    // Sæt de nye felter som Prisma-klienten ikke kender endnu
    await prisma.$executeRaw`
      UPDATE "Order"
      SET "driverNote"     = ${body.driverNote ?? null},
          "poNumber"       = ${body.poNumber ?? null},
          "orderedByName"  = ${(session.user as any)?.name ?? null},
          "orderedByEmail" = ${(session.user as any)?.email ?? null}
      WHERE id = ${order.id}
    `

    // Link specialvare-reservationer til ordren
    if (body.reservationIds?.length) {
      await prisma.specialVareReservation.updateMany({
        where: { id: { in: body.reservationIds }, customerId: userId, status: 'PENDING' },
        data: { orderId: order.id, status: 'CONFIRMED' },
      })
    }

    // Opret portal-besked hvis kunden har skrevet en besked med ordren
    if (notes?.trim()) {
      const msgExpires = new Date(); msgExpires.setDate(msgExpires.getDate() + 30)
      const deliveryLabel = deliveryDate.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })
      const msgBody = `Besked ved ordre (levering ${deliveryLabel}):\n${notes.trim()}`
      await prisma.$executeRaw`
        INSERT INTO "Message" (id, "customerId", sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt", "expiresAt")
        VALUES (gen_random_uuid()::text, ${userId}, 'customer', ${customer.name}, ${msgBody}, false, true, NOW(), ${msgExpires})
      `
      // Notificer BC om ulæst besked
      if (customer.bcCustomerNumber) {
        flagBeskedUlaest(customer.bcCustomerNumber).catch(() => {})
      }
    }

    // Send direkte til BC — linjer oprettes med shipQuantity=0 (afventer godkendelse)
    try {
      // Linje-bemærkninger (portal) pr. varenr — sendes til salgslinjens Portal Kundebemærkning.
      const noteByItem = new Map<string, string>()
      for (const l of lines) if (typeof l?.note === 'string' && l.note.trim()) noteByItem.set(l.bcItemNumber, l.note.trim())

      const bc = await createBCSalesOrder(
        activeCustomerNo,   // Sell-to = valgt butik (bestil på vegne af)
        deliveryDate,
        order.id,
        order.lines.map((l) => ({
          itemNumber: l.bcItemNumber,
          quantity:   l.quantity,
          uomCode:    l.uom,
          note:       noteByItem.get(l.bcItemNumber),
        })),
        poNumber ?? undefined,
        driverNote ?? undefined,
        notes ?? undefined,
        shipmentMethodCode ?? undefined,   // kundens VALGTE leveringskode → BC (transit/afsendelse)
      )

      // KBH-levering: varer på lager i København → kundens XVEN-ordre. Kom ALT derfra, er
      // Hirtshals-ordren slettet, og portalens ordre peger så på XVEN-ordren i stedet.
      const kbh = await kbhOpsplit({
        ordreNr: bc.number, sletTomHoved: true, navne: varenavne(lines),
        portalKunde: customer, kundeNr: activeCustomerNo,
      })

      // Opdater til SENT_TO_BC med BC-referencer
      await prisma.order.update({
        where: { id: order.id },
        data:  {
          status:       'SENT_TO_BC',
          bcOrderNumber: kbh?.hovedSlettet ? kbh.xvenOrdre : bc.number,
          bcOrderId:    kbh?.hovedSlettet ? null : bc.id,
          approvedAt:   new Date(),
        },
      })

      // BC-verifikation: hvis post-create GET ikke kunne bekraefte alle linjer → alarm
      if (!bc.verified) {
        console.error(`BC-verifikation FEJLEDE for ordre ${order.id}: ${bc.verifyError}`)
        await sendBCVerificationAlert({
          customer,
          portalOrderId: order.id,
          bcOrderNumber: bc.number,
          expected: order.lines.length,
          actual: bc.bcLineCount,
          reason: bc.verifyError ?? 'Ukendt verifikationsfejl',
        }).catch((e) => console.warn('Alert-mail fejlede:', e.message))
      }

      // Send email-notifikation
      await sendOrderNotification({
        customer,
        order: { ...order, status: 'SENT_TO_BC', bcOrderNumber: bc.number },
        lines: order.lines,
      }).catch((e) => console.warn('Email-notifikation fejlede:', e.message))

      return NextResponse.json({ orderId: order.id, bcOrderNumber: kbh?.hovedSlettet ? kbh.xvenOrdre : bc.number, kbh }, { status: 201 })

    } catch (bcErr: any) {
      // BC fejlede — behold SUBMITTED så admin kan gensende manuelt
      console.error('BC-fejl ved ordreindsendelsse:', bcErr.message)

      await sendOrderNotification({
        customer,
        order,
        lines: order.lines,
      }).catch((e) => console.warn('Email-notifikation fejlede:', e.message))

      // Returner success til kunden — ordren er gemt og admin notificeres
      return NextResponse.json({ orderId: order.id, bcWarning: t('ordreModtaget') }, { status: 201 })
    }

  } catch (e: any) {
    console.error('Ordre-fejl:', e)
    return NextResponse.json({ error: t('serverfejl') }, { status: 500 })
  }
}

/** Varenr → dansk navn fra kurven (til Venmarks KBH-besked). */
function varenavne(lines: any[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of lines ?? []) if (l?.bcItemNumber) m.set(l.bcItemNumber, l.itemName || l.bcItemNumber)
  return m
}
