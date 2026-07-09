export async function loadUsers(prisma: any, ids: string[]) {
  const users = [];
  for (const id of ids) {
    users.push(await prisma.user.findUnique({ where: { id } }));
  }
  return users;
}
