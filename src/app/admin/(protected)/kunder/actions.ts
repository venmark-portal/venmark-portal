'use server'

import { prisma } from '@/lib/prisma'
import { hash } from 'bcryptjs'
import { revalidatePath } from 'next/cache'

export async function createCustomer(data: {
  name:                 string
  email:                string
  password:             string
  bcCustomerNumber:     string
  bcPriceGroup:         string
  bcStandardSalesCode:  string
}) {
  const passwordHash = await hash(data.password, 12)
  const created = await prisma.customer.create({
    data: {
      name:                data.name.trim(),
      email:               data.email.toLowerCase().trim(),
      passwordHash,
      bcCustomerNumber:    data.bcCustomerNumber.trim(),
      bcPriceGroup:        data.bcPriceGroup.trim() || null,
      bcStandardSalesCode: data.bcStandardSalesCode.trim() || null,
      isActive:            true,
    },
    select: {
      id: true, name: true, email: true,
      bcCustomerNumber: true, bcPriceGroup: true,
      bcStandardSalesCode: true,
      isActive: true, createdAt: true,
    },
  })
  revalidatePath('/admin/kunder')
  return { ...created, _count: { orders: 0 } }
}

export async function updateCustomer(id: string, data: {
  name:                string
  email:               string
  password:            string   // tom = behold eksisterende
  bcCustomerNumber:    string
  bcPriceGroup:        string
  bcStandardSalesCode: string
}) {
  const patch: Record<string, unknown> = {
    name:                data.name.trim(),
    email:               data.email.toLowerCase().trim(),
    bcCustomerNumber:    data.bcCustomerNumber.trim(),
    bcPriceGroup:        data.bcPriceGroup.trim() || null,
    bcStandardSalesCode: data.bcStandardSalesCode.trim() || null,
  }
  if (data.password) {
    patch.passwordHash = await hash(data.password, 12)
  }
  await prisma.customer.update({ where: { id }, data: patch })
  revalidatePath('/admin/kunder')
}

export async function toggleCustomerActive(id: string) {
  const c = await prisma.customer.findUnique({ where: { id }, select: { isActive: true } })
  if (!c) return
  await prisma.customer.update({ where: { id }, data: { isActive: !c.isActive } })
  revalidatePath('/admin/kunder')
}
