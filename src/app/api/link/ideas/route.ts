import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const name = z.string().trim().min(1).max(40).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));
const title = z.string().trim().min(1).max(500).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));
const note = z.string().max(2000).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n|\t/g, "")));
const legacyId = z.string().regex(/^[a-f0-9-]{36}$/i);

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createCategory"), name }),
  z.object({ action: z.literal("renameCategory"), id, name }),
  z.object({ action: z.literal("deleteCategory"), id }),
  z.object({ action: z.literal("createIdea"), title, note: note.optional(), categoryId: id.optional() }),
  z.object({ action: z.literal("updateIdea"), id, title: title.optional(), note: note.optional(), categoryId: id.optional(), pinned: z.boolean().optional(), archived: z.boolean().optional(), completed: z.boolean().optional() }),
  z.object({ action: z.literal("deleteIdea"), id }),
  z.object({ action: z.literal("import"), categories: z.array(name).max(40), ideas: z.array(z.object({ sourceId: legacyId, title, category: name, createdAt: z.string().datetime() })).max(30) }),
]);

function categoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function categoryKey(value: string) {
  return categoryName(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

async function inbox(userId: string, tx: Prisma.TransactionClient = prisma) {
  return tx.ideaCategory.upsert({
    where: { userId_key: { userId, key: "inbox" } },
    update: {},
    create: { userId, name: "Inbox", key: "inbox", position: 0 },
  });
}

async function ownedCategory(userId: string, categoryId: string) {
  return prisma.ideaCategory.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
}

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "ideas.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const cursor = new URL(request.url).searchParams.get("cursor");
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim().slice(0, 100) ?? "";
  const categoryId = params.get("categoryId");
  const archived = params.get("archived") === "1";
  const completed = params.get("completed");
  if (cursor && !id.safeParse(cursor).success) return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  if (categoryId && !id.safeParse(categoryId).success) return NextResponse.json({ error: "invalid category" }, { status: 400 });
  if (completed !== null && completed !== "0" && completed !== "1") return NextResponse.json({ error: "invalid completion filter" }, { status: 400 });
  const userId = auth.device.userId;
  await inbox(userId);
  const where: Prisma.IdeaWhereInput = { userId, archived, ...(categoryId ? { categoryId } : {}), ...(completed !== null ? { completedAt: completed === "1" ? { not: null } : null } : {}), ...(query ? { OR: [{ title: { contains: query } }, { note: { contains: query } }] } : {}) };
  if (cursor && !(await prisma.idea.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) return NextResponse.json({ error: "idea page not found" }, { status: 404 });
  const [categories, rows] = await Promise.all([
    prisma.ideaCategory.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 100, select: { id: true, name: true, position: true } }),
    prisma.idea.findMany({ where, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }], take: 101, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, categoryId: true, title: true, note: true, pinned: true, archived: true, completedAt: true, createdAt: true, updatedAt: true } }),
  ]);
  return NextResponse.json({ categories, ideas: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "ideas.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "ideas-manage", 60);
  if (!rate.allowed) return NextResponse.json({ error: "too many idea changes" }, { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } });
  const parsed = command.safeParse(await boundedJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid idea request" }, { status: 400 });
  const input = parsed.data;
  const userId = auth.device.userId;
  await inbox(userId);
  try {
    switch (input.action) {
      case "createCategory": {
        const count = await prisma.ideaCategory.count({ where: { userId } });
        if (count >= 100) return NextResponse.json({ error: "category limit reached" }, { status: 409 });
        const category = await prisma.ideaCategory.create({ data: { userId, name: categoryName(input.name), key: categoryKey(input.name), position: count + 1 } });
        return NextResponse.json({ category }, { status: 201 });
      }
      case "renameCategory": {
        const existing = await prisma.ideaCategory.findFirst({ where: { id: input.id, userId }, select: { key: true } });
        if (!existing) return NextResponse.json({ error: "category not found" }, { status: 404 });
        if (existing.key === "inbox") return NextResponse.json({ error: "Inbox cannot be renamed" }, { status: 409 });
        const result = await prisma.ideaCategory.updateMany({ where: { id: input.id, userId }, data: { name: categoryName(input.name), key: categoryKey(input.name) } });
        return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "category not found" }, { status: 404 });
      }
      case "deleteCategory": {
        const category = await prisma.ideaCategory.findFirst({ where: { id: input.id, userId } });
        if (!category) return NextResponse.json({ error: "category not found" }, { status: 404 });
        if (category.key === "inbox") return NextResponse.json({ error: "Inbox cannot be deleted" }, { status: 409 });
        await prisma.$transaction(async (tx) => {
          const target = await inbox(userId, tx);
          await tx.idea.updateMany({ where: { userId, categoryId: category.id }, data: { categoryId: target.id } });
          await tx.ideaCategory.delete({ where: { id: category.id } });
        });
        return NextResponse.json({ ok: true });
      }
      case "createIdea": {
        const category = input.categoryId ? await ownedCategory(userId, input.categoryId) : await inbox(userId);
        if (!category) return NextResponse.json({ error: "category not found" }, { status: 404 });
        const idea = await prisma.idea.create({ data: { userId, categoryId: category.id, title: input.title, note: input.note ?? "" } });
        return NextResponse.json({ idea }, { status: 201 });
      }
      case "updateIdea": {
        if (input.categoryId && !(await ownedCategory(userId, input.categoryId))) return NextResponse.json({ error: "category not found" }, { status: 404 });
      const result = await prisma.idea.updateMany({ where: { id: input.id, userId }, data: { title: input.title, note: input.note, categoryId: input.categoryId, pinned: input.pinned, archived: input.archived, completedAt: input.completed === undefined ? undefined : input.completed ? new Date() : null } });
        return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "idea not found" }, { status: 404 });
      }
      case "deleteIdea": {
        const result = await prisma.idea.deleteMany({ where: { id: input.id, userId } });
        return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "idea not found" }, { status: 404 });
      }
      case "import": {
        if (input.categories.length + input.ideas.length === 0) return NextResponse.json({ error: "nothing to import" }, { status: 400 });
        const existingKeys = await prisma.ideaCategory.findMany({ where: { userId }, select: { key: true } });
        const importedKeys = new Set([...input.categories, ...input.ideas.map((item) => item.category)].map(categoryKey));
        if (new Set([...existingKeys.map((item) => item.key), ...importedKeys]).size > 100) return NextResponse.json({ error: "category limit reached" }, { status: 409 });
        const imported = await prisma.$transaction(async (tx) => {
          const categories = new Map<string, string>();
          for (const label of [...input.categories, ...input.ideas.map((item) => item.category)]) {
            const key = categoryKey(label);
            if (categories.has(key)) continue;
            const category = await tx.ideaCategory.upsert({ where: { userId_key: { userId, key } }, update: {}, create: { userId, name: categoryName(label), key, position: existingKeys.length + categories.size + 1 } });
            categories.set(key, category.id);
          }
          let count = 0;
          for (const item of input.ideas) {
            const sourceId = item.sourceId.toLowerCase();
            const existing = await tx.idea.findUnique({ where: { userId_sourceId: { userId, sourceId } }, select: { id: true } });
            await tx.idea.upsert({
              where: { userId_sourceId: { userId, sourceId } },
              update: {},
              create: { userId, sourceId, categoryId: categories.get(categoryKey(item.category))!, title: item.title, createdAt: new Date(item.createdAt) },
            });
            if (!existing) count += 1;
          }
          return count;
        });
        return NextResponse.json({ ok: true, imported });
      }
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "category already exists" }, { status: 409 });
    throw error;
  }
}
