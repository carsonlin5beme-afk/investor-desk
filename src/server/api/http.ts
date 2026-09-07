import { NextResponse } from "next/server";

export const jsonError = (message: string, status = 400, details?: unknown) =>
  NextResponse.json(
    {
      error: message,
      details,
    },
    { status },
  );

export const asCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
