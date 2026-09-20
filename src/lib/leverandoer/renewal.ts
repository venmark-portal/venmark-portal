import { prisma } from '@/lib/prisma'

/**
 * Fornyelse af leverandørerklæring: ny runde = PENDING-kopi af forrige indsendelse, så
 * leverandøren kun skal OPDATERE. Bruges både af send-link (manuel) og cron (automatisk
 * 45 dage før nextRenewalDate). Underskrift + bekræftelse kopieres IKKE.
 */

type Prev = Awaited<ReturnType<typeof prisma.supplierDeclaration.findFirst>>

export async function createRenewalDeclaration(
  bcVendorNo: string,
  prev: Prev,
  opts: { vendorName?: string | null; vendorEmail?: string | null; lang?: string | null; cc?: string | null },
) {
  return prisma.supplierDeclaration.create({
    data: {
      bcVendorNo,
      lang: opts.lang ?? prev?.lang ?? 'en',
      status: 'PENDING',
      nextRenewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      companyName:        opts.vendorName ?? prev?.companyName ?? null,
      vatNo:             prev?.vatNo,
      address:           prev?.address,
      country:           prev?.country,
      phone:             prev?.phone,
      email:             opts.vendorEmail ?? prev?.email ?? null,
      ccEmail:           opts.cc ?? prev?.ccEmail ?? null,
      contactPerson:     prev?.contactPerson,
      qualityManager:    prev?.qualityManager,
      qualityManagerEmail: prev?.qualityManagerEmail,
      qualityManagerPhone: prev?.qualityManagerPhone,
      emergencyPhone:    prev?.emergencyPhone,
      hasThirdPartyCert: prev?.hasThirdPartyCert,
      certTypes:         prev?.certTypes,
      certData:          prev?.certData,
      haccpAnswers:      prev?.haccpAnswers,
      selfControlAnswers:prev?.selfControlAnswers,
      signerName:        prev?.signerName,
      signerTitle:       prev?.signerTitle,
      signerEmail:       prev?.signerEmail,
    },
  })
}

/** Rykkernummer i en fornyelsesrunde = antal link-/rykkermails sendt på erklæringen + 1. */
export const ROUND_MAIL_TYPES = ['INITIAL', 'RENEWAL'] as const
export function isRoundMail(type: string): boolean {
  return type === 'INITIAL' || type.startsWith('RENEWAL_')
}
