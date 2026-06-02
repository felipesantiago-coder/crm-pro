import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const tags = await db.tag.findMany({
      include: {
        _count: {
          select: { clients: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, color } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const existingTag = await db.tag.findUnique({ where: { name: name.trim() } });
    if (existingTag) {
      return NextResponse.json({ error: 'Tag with this name already exists' }, { status: 409 });
    }

    const tag = await db.tag.create({
      data: {
        name: name.trim(),
        color: color?.trim() || '#0d9488',
      },
      include: {
        _count: {
          select: { clients: true },
        },
      },
    });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    console.error('Error creating tag:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}
