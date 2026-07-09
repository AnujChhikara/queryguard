export async function loadUsers(prisma: any, ids: string[]) {
  return prisma.user.findMany({ where: { id: { in: ids } } });
}
