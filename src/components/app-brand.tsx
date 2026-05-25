"use client";

import Image from "next/image";
import Link from "next/link";

type Props = {
  href?: string;
  className?: string;
  textClassName?: string;
};

export function AppBrand({ href, className = "", textClassName = "" }: Props) {
  const content = (
    <>
      <Image src="/assets/cross-mark.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" aria-hidden="true" />
      <span className={`min-w-0 whitespace-nowrap ${textClassName}`}>
        <span className="block text-xl font-bold tracking-tight text-[#070119]">findmydoc</span>
        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[#FF2D2D] bg-[#5A000A] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF2D2D]" aria-hidden="true" />
          FounderOps
        </span>
      </span>
    </>
  );

  const classes = `flex items-center gap-3 ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
