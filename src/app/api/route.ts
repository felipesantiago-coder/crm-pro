import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // Retry is automatic via Prisma client extension in db.ts
    await db.$queryRaw`SELECT 1 as ok`;

    return NextResponse.json({
      status: "ok",
      message: "CRM Pro API is running",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[HEALTH] Database connection failed:", error);
    return NextResponse.json(
      { status: "error", message: "Database connection failed" },
      { status: 503 }
    );
  }
}
