"use client";
import Image from "next/image";
import Link from "next/link";
import { UsersIcon } from "@heroicons/react/24/solid";

function CabinCard({
  cabin,
  showLink = true,
  embed = false,
  embedCompact = false,
  className = "",
}) {
  const { id, name, maxCapacity, regularPrice, discount, image } = cabin;

  /** 工具卡片「查询酒店」：图贴顶、左右无内层留白；圆角仅最外层 ToolCallCard（5B）；宽容器再收紧文案边距（3A） */
  if (embed && embedCompact) {
    return (
      <div
        className={`flex flex-col overflow-hidden rounded-none border-0 bg-primary-950/40 ${className}`}
      >
        <div className="relative w-full aspect-[21/9] max-h-[9.5rem] shrink-0">
          <Image
            src={image}
            fill
            alt={`Cabin ${name}`}
            className="object-cover"
            sizes="(max-width: 480px) 100vw, 360px"
          />
        </div>
        <div className="border-t border-primary-800/50 px-2.5 py-2 @lg/msglist:px-1.5 @lg/msglist:py-1.5">
          <h3 className="text-accent-500 font-semibold text-sm mb-1">
            Cabin {name}
          </h3>
          <div className="flex gap-1.5 items-center">
            <UsersIcon className="h-3.5 w-3.5 text-primary-600 shrink-0" />
            <p className="text-xs text-primary-200 leading-snug">
              For up to <span className="font-bold">{maxCapacity}</span> guests
            </p>
          </div>
          <p className="flex flex-wrap gap-1.5 justify-end items-baseline mt-1.5">
            {discount > 0 ? (
              <>
                <span className="text-lg font-[350]">
                  ${regularPrice - discount}
                </span>
                <span className="line-through font-semibold text-primary-600 text-xs">
                  ${regularPrice}
                </span>
              </>
            ) : (
              <span className="text-lg font-[350]">${regularPrice}</span>
            )}
            <span className="text-primary-200 text-xs">/ night</span>
          </p>
        </div>
      </div>
    );
  }

  if (embed) {
    return (
      <div
        className={`flex flex-col border border-primary-800 overflow-hidden rounded-lg bg-primary-950 ${className}`}
      >
        {/* 聊天内嵌：更扁封面，减少全屏下「图过大」 */}
        <div className="relative w-full aspect-[21/9] max-h-[9.5rem] shrink-0 border-b border-primary-800">
          <Image
            src={image}
            fill
            alt={`Cabin ${name}`}
            className="object-cover"
            sizes="(max-width: 480px) 100vw, 360px"
          />
        </div>
        <div className="px-2.5 py-2 sm:px-3 sm:py-2.5">
          <h3 className="text-accent-500 font-semibold text-sm mb-1">
            Cabin {name}
          </h3>
          <div className="flex gap-1.5 items-center">
            <UsersIcon className="h-3.5 w-3.5 text-primary-600 shrink-0" />
            <p className="text-xs text-primary-200 leading-snug">
              For up to <span className="font-bold">{maxCapacity}</span> guests
            </p>
          </div>
          <p className="flex flex-wrap gap-1.5 justify-end items-baseline mt-1.5">
            {discount > 0 ? (
              <>
                <span className="text-lg font-[350]">
                  ${regularPrice - discount}
                </span>
                <span className="line-through font-semibold text-primary-600 text-xs">
                  ${regularPrice}
                </span>
              </>
            ) : (
              <span className="text-lg font-[350]">${regularPrice}</span>
            )}
            <span className="text-primary-200 text-xs">/ night</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex border-primary-800 border ${className}`}>
      <div className="flex-1 relative">
        <Image
          src={image}
          fill
          alt={`Cabin ${name}`}
          className="object-cover border-r border-primary-800"
        />
      </div>

      <div className="flex-grow">
        <div className="pt-5 pb-4 px-7 bg-primary-950">
          <h3 className="text-accent-500 font-semibold text-2xl mb-3">
            Cabin {name}
          </h3>

          <div className="flex gap-3 items-center mb-2">
            <UsersIcon className="h-5 w-5 text-primary-600" />
            <p className="text-lg text-primary-200">
              For up to <span className="font-bold">{maxCapacity}</span> guests
            </p>
          </div>

          <p className="flex gap-3 justify-end items-baseline">
            {discount > 0 ? (
              <>
                <span className="text-3xl font-[350]">
                  ${regularPrice - discount}
                </span>
                <span className="line-through font-semibold text-primary-600">
                  ${regularPrice}
                </span>
              </>
            ) : (
              <span className="text-3xl font-[350]">${regularPrice}</span>
            )}
            <span className="text-primary-200">/ night</span>
          </p>
        </div>

        {showLink && (
          <div className="bg-primary-950 border-t border-t-primary-800 text-right">
            <Link
              href={`/cabins/${id}`}
              className="border-l border-primary-800 py-4 px-6 inline-block hover:bg-accent-600 transition-all hover:text-primary-900"
            >
              Details & reservation &rarr;
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default CabinCard;
