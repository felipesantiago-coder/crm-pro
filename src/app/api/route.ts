import { NextResponse } from "next/server";
import { db, ensureDbConnection } from "@/lib/db";

export async function GET() {
  try {
    // Wake up the database and verify connection is alive
    await ensureDbConnection();
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
