import { redirect } from 'next/navigation'

// Faste ordrer håndteres nu automatisk i BC (Portal Standing Order Line).
// Kunder kan se og justere foreslåede mængder på bestillingssiden.
export default function FastPage() {
  redirect('/portal/bestil')
}
