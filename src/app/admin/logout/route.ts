import { NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/admin/server';

export async function POST(req: Request) {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/admin/login', req.url));
}
