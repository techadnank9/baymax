import { redirect } from 'next/navigation';
import type { JSX } from 'react';

export default function HomePage(): JSX.Element {
  redirect('/intake');
}
