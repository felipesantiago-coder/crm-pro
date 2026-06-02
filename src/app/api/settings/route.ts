import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const settings = await db.userSettings.findMany({
      orderBy: { key: 'asc' },
    });

    const settingsMap: Record<string, string> = {};
    settings.forEach((s) => {
      settingsMap[s.key] = s.value;
    });

    return NextResponse.json(settingsMap);
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || key.trim() === '') {
      return NextResponse.json({ error: 'Key is required' }, { status: 400 });
    }
    if (value === undefined || value === null) {
      return NextResponse.json({ error: 'Value is required' }, { status: 400 });
    }

    const setting = await db.userSettings.upsert({
      where: { key: key.trim() },
      update: { value: String(value) },
      create: { key: key.trim(), value: String(value) },
    });

    return NextResponse.json(setting);
  } catch (error) {
    console.error('Error updating setting:', error);
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
  }
}
