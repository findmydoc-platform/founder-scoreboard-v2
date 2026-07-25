"use client";

import Link from "next/link";

type Props = {
  href?: string;
  className?: string;
  textClassName?: string;
  size?: "default" | "login";
};

export function AppBrand({ href, className = "", textClassName = "", size = "default" }: Props) {
  const isLogin = size === "login";
  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/cross-mark.svg"
        alt=""
        className={isLogin ? "h-14 w-14 shrink-0" : "h-10 w-10 shrink-0"}
        aria-hidden="true"
      />
      <span className={`min-w-0 whitespace-nowrap ${textClassName}`}>
        <span className={isLogin
          ? "block text-[28px] font-bold leading-none tracking-tight text-[#070119]"
          : "block text-xl font-bold tracking-tight text-[#070119]"}
        >
          findmydoc
        </span>
        <span className={isLogin
          ? "mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#FF2D2D] bg-[#5A000A] px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-white"
          : "mt-0.5 inline-flex items-center gap-1 rounded-full border border-[#FF2D2D] bg-[#5A000A] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white"}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF2D2D]" aria-hidden="true" />
          FounderOps
        </span>
      </span>
    </>
  );

  const classes = `flex items-center ${isLogin ? "gap-5" : "gap-3"} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
