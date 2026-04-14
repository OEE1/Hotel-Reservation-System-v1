"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Loader2, CheckCircle, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { ToolCallStatus } from "@/store/chatStore";
import type { ReactNode } from "react";
import CabinCard from "@/components/cabins/CabinCard";
import Cabin from "@/components/cabins/Cabin";
import { useChatStream } from "@/lib/sseClient/useChatStream";
import { ChatBookingModal } from "./ChatBookingModal";

function formatMoney(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  return `$${n}`;
}

function safeJsonParse<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

const TOOL_META: Record<string, { icon?: ReactNode; label: string }> = {
  search_available_cabins: { label: "查询可用酒店" },
  create_booking: { label: "创建预订" },
  get_my_bookings: { label: "我的预订" },
  delete_booking: { label: "删除预订" },
};

/** 订单/工具卡片缩略图：随 MessageList @container 宽度在 min~max 间变化（cqw） */
const TOOL_BOOKING_THUMB =
  "relative shrink-0 overflow-hidden rounded-lg border border-primary-700 w-[clamp(5rem,22cqw,7.5rem)] aspect-[4/3]";

/** 酒店轮播内 CabinCard：占满工具卡内容区（勿再加 24rem/cqw 上限，否则全屏下列很宽时图片仍只有 ~384px，两侧空白大） */
const TOOL_CABIN_CARD_WRAP = "w-full min-w-0 max-w-full";

/** 工具卡片内轮播：横排大按钮 + 序号（酒店 / 订单共用） */
function ToolCarouselNav({
  index,
  total,
  onPrev,
  onNext,
  prevLabel = "上一项",
  nextLabel = "下一项",
  align = "center",
}: {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
  align?: "center" | "end";
}) {
  if (total <= 1) return null;
  const justify = align === "end" ? "justify-end" : "justify-center";
  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${justify} py-0.5`}>
      <button
        type="button"
        onClick={onPrev}
        disabled={index <= 0}
        className="inline-flex items-center justify-center p-2.5 rounded-lg border border-primary-600 bg-primary-800/90 text-primary-100 hover:bg-primary-700 hover:border-accent-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label={prevLabel}
      >
        <ChevronLeft size={20} strokeWidth={2} />
      </button>
      <span className="text-xs text-primary-400 tabular-nums min-w-[3.25rem] text-center">
        {index + 1} / {total}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={index >= total - 1}
        className="inline-flex items-center justify-center p-2.5 rounded-lg border border-primary-600 bg-primary-800/90 text-primary-100 hover:bg-primary-700 hover:border-accent-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label={nextLabel}
      >
        <ChevronRight size={20} strokeWidth={2} />
      </button>
    </div>
  );
}

export function ToolCallCard({ tool }: { tool: ToolCallStatus }) {
  const meta = TOOL_META[tool.name] ?? { label: tool.name };
  const output = tool.output as Record<string, unknown> | undefined;

  const { sendMessage } = useChatStream();

  const toolInput = (tool.input ?? safeJsonParse<Record<string, unknown>>(tool.arguments)) as
    | Record<string, unknown>
    | undefined;

  const header = useMemo(() => {
    const label = meta.label;
    if (tool.status === "running") return `${label}（进行中）`;
    if (tool.status === "done") return `${label}（完成）`;
    if (tool.status === "error") return `${label}（失败）`;
    return label;
  }, [meta.label, tool.status]);

  const statusIcon = (
    <span className="shrink-0 ml-auto">
      {tool.status === "running" && (
        <Loader2 size={12} className="animate-spin text-accent-400" />
      )}
      {tool.status === "done" && <CheckCircle size={12} className="text-green-400" />}
      {tool.status === "error" && <XCircle size={12} className="text-red-400" />}
    </span>
  );

  // 仅 search_available_cabins 需要酒店轮播
  const cabinsDone =
    tool.status === "done" && tool.name === "search_available_cabins"
      ? (output?.cabins as any[]) ?? []
      : [];
  const [hotelIndex, setHotelIndex] = useState(0);
  const currentHotel = cabinsDone[hotelIndex];

  useEffect(() => {
    setHotelIndex(0);
  }, [tool.id]);

  // 仅 get_my_bookings / delete_booking 需要订单轮播
  const bookingsDone =
    tool.status === "done" && tool.name === "get_my_bookings"
      ? ((output?.bookings as any[]) ?? [])
      : [];
  const deletedBooking =
    tool.status === "done" && tool.name === "delete_booking"
      ? (output?.deletedBooking as any)
      : null;
  const remainingBookings =
    tool.status === "done" && tool.name === "delete_booking"
      ? ((output?.bookings as any[]) ?? [])
      : [];

  const [bookingIndex, setBookingIndex] = useState(0);
  useEffect(() => {
    setBookingIndex(0);
  }, [tool.id]);

  const currentBooking =
    tool.name === "delete_booking" ? remainingBookings[bookingIndex] : bookingsDone[bookingIndex];

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [reserveHotel, setReserveHotel] = useState<any | null>(null);

  return (
    <div className="@container mb-0 rounded-xl border border-primary-700 bg-primary-900/60 overflow-hidden">
      {/* 头部：宽容器下再收紧 padding（2C + 4A） */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs @lg/msglist:gap-1 @lg/msglist:px-2 @lg/msglist:py-1">
        <span className="text-primary-300 font-medium">{header}</span>
        {toolInput && Object.keys(toolInput).length > 0 ? (
          <span className="text-primary-500 truncate flex-1">
            {Object.values(toolInput)
              .slice(0, 4)
              .join(" · ")}
          </span>
        ) : tool.arguments ? (
          <span className="text-primary-500 truncate flex-1" title={tool.arguments}>
            {tool.arguments}
          </span>
        ) : null}
        {statusIcon}
      </div>

      {/* 结果展示 */}
      {tool.status === "done" && output && (
        <div className="border-t border-primary-700/60 px-2.5 pb-2.5 pt-1.5 @lg/msglist:px-2 @lg/msglist:pb-2 @lg/msglist:pt-1">
          {/* 1) search_available_cabins：可预订酒店轮播（单视口） */}
          {tool.name === "search_available_cabins" && (
            <div className="space-y-2 @lg/msglist:space-y-1.5">
              {cabinsDone.length === 0 ? (
                <p className="text-xs text-primary-400">没有找到符合条件的可用酒店。</p>
              ) : (
                <>
                  {/* 负 margin 抵消结果区内边距，使封面横向贴齐工具卡内缘（1C/2B）；仅酒店查询 */}
                  <div className="-mx-2.5 min-w-0 @lg/msglist:-mx-2">
                    <div className={TOOL_CABIN_CARD_WRAP}>
                      {currentHotel && (
                        <CabinCard
                          cabin={currentHotel}
                          showLink={false}
                          embed
                          embedCompact
                        />
                      )}
                    </div>
                  </div>

                  <ToolCarouselNav
                    index={hotelIndex}
                    total={cabinsDone.length}
                    onPrev={() => setHotelIndex((i) => Math.max(0, i - 1))}
                    onNext={() =>
                      setHotelIndex((i) => Math.min(cabinsDone.length - 1, i + 1))
                    }
                    prevLabel="上一间酒店"
                    nextLabel="下一间酒店"
                  />

                  <div className="flex gap-2 justify-end flex-wrap pt-0.5">
                    <button
                      type="button"
                      onClick={() => setDetailsOpen(true)}
                      className="px-2.5 py-1.5 text-sm rounded-lg border border-primary-700 text-primary-200 hover:border-accent-500/60 hover:text-primary-100 transition-colors"
                    >
                      查看详细酒店信息
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReserveHotel(currentHotel);
                        setBookingModalOpen(true);
                      }}
                      className="px-2.5 py-1.5 text-sm rounded-lg bg-accent-500 text-primary-900 hover:bg-accent-600 transition-colors"
                      disabled={!currentHotel}
                    >
                      预定
                    </button>
                  </div>
                </>
              )}
              {/* 详情弹层 */}
              {detailsOpen && currentHotel && (
                <div
                  className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="bg-primary-950 border border-primary-700 rounded-2xl w-full max-w-4xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-primary-700">
                      <div className="text-sm font-semibold text-primary-100">
                        Cabin {currentHotel.name} 详情
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetailsOpen(false)}
                        className="p-1.5 text-primary-400 hover:text-primary-100 transition-colors"
                        aria-label="Close details"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="p-5 overflow-y-auto max-h-[80vh]">
                      <Cabin cabin={currentHotel} />
                    </div>
                  </div>
                </div>
              )}

              {/* 预定弹层 */}
              {bookingModalOpen && reserveHotel && (
                <ChatBookingModal
                  cabinId={reserveHotel.id}
                  maxCapacity={reserveHotel.maxCapacity}
                  checkIn={String(toolInput?.checkIn ?? "")}
                  checkOut={String(toolInput?.checkOut ?? "")}
                  initialNumGuests={typeof toolInput?.numGuests === "number" ? toolInput?.numGuests : undefined}
                  sendMessage={sendMessage}
                  onClose={() => setBookingModalOpen(false)}
                />
              )}
            </div>
          )}

          {/* 2) create_booking：展示刚创建订单 + 查看全部预订 */}
          {tool.name === "create_booking" && (
            <div className="space-y-2 @lg/msglist:space-y-1.5">
              <div className="text-xs text-primary-300">
                {output && typeof output === "object" ? "已创建预订：" : ""}
              </div>
              {output && "booking" in output && (output.booking as any) && (
                <div className="rounded-xl border border-primary-700/60 bg-primary-900/40 p-3">
                  {(() => {
                    const booking = (output as any).booking as any;
                    const img = booking?.cabinImage;
                    const name = booking?.cabinName;
                    return (
                      <div className="flex gap-3 min-w-0">
                        <div className={TOOL_BOOKING_THUMB}>
                          {img ? (
                            <Image
                              src={img}
                              alt={name ? `Cabin ${name}` : "Cabin"}
                              fill
                              className="object-cover"
                              sizes="(max-width: 420px) 30vw, 120px"
                            />
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-primary-100">
                            Cabin {name}
                          </div>
                          <div className="text-xs text-primary-400 mt-1">
                            {booking?.startDate} → {booking?.endDate}（{booking?.numNights} 晚）
                          </div>
                          <div className="text-xs text-primary-300 mt-2">
                            共 {booking?.numGuests ?? ""} 位住客
                          </div>
                          <div className="text-sm text-accent-400 mt-2 font-semibold">
                            总价：{formatMoney(booking?.totalPrice)}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    sendMessage(
                      "查看所有预定：请调用 `get_my_bookings`，并基于结果用中文回复。"
                    )
                  }
                  className="px-3 py-2 rounded-lg bg-primary-800 border border-primary-700 text-primary-100 hover:bg-primary-800/70 transition-colors"
                >
                  查看所有预定
                </button>
              </div>
            </div>
          )}

          {/* 3) get_my_bookings：订单轮播 + 删除 */}
          {tool.name === "get_my_bookings" && (
            <div className="space-y-2 @lg/msglist:space-y-1.5">
              {bookingsDone.length === 0 ? (
                <p className="text-xs text-primary-400">暂无预订。</p>
              ) : (
                <>
                  {currentBooking && (
                    <div className="rounded-xl border border-primary-700/60 bg-primary-900/40 p-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={TOOL_BOOKING_THUMB}>
                          {currentBooking?.cabins?.image ? (
                            <Image
                              src={currentBooking.cabins.image}
                              alt={currentBooking.cabins?.name ? `Cabin ${currentBooking.cabins.name}` : "Cabin"}
                              fill
                              className="object-cover"
                              sizes="(max-width: 420px) 30vw, 140px"
                            />
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-primary-100 truncate">
                            {currentBooking?.numNights} nights in Cabin {currentBooking?.cabins?.name}
                          </div>
                          <div className="text-xs text-primary-400 mt-1">
                            {currentBooking?.startDate} → {currentBooking?.endDate}
                          </div>
                          <div className="text-xs text-primary-300 mt-2">
                            {currentBooking?.numGuests} 位住客
                          </div>
                          <div className="text-sm text-accent-400 mt-2 font-semibold">
                            {formatMoney(currentBooking?.totalPrice)}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end mt-3">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                          onClick={() => {
                            const bookingId = currentBooking?.id;
                            if (!bookingId) return;
                            if (!confirm("确定删除这条预订订单吗？")) return;
                            sendMessage(
                              "删除预订：请调用 `delete_booking`。参数如下：\n" +
                                JSON.stringify({ bookingId })
                            );
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )}

                  {bookingsDone.length > 1 && (
                    <ToolCarouselNav
                      index={bookingIndex}
                      total={bookingsDone.length}
                      onPrev={() => setBookingIndex((i) => Math.max(0, i - 1))}
                      onNext={() =>
                        setBookingIndex((i) => Math.min(bookingsDone.length - 1, i + 1))
                      }
                      prevLabel="上一笔预订"
                      nextLabel="下一笔预订"
                      align="end"
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* 4) delete_booking：展示删除结果 + 更新后的订单轮播 */}
          {tool.name === "delete_booking" && (
            <div className="space-y-2 @lg/msglist:space-y-1.5">
              {deletedBooking ? (
                <div className="rounded-xl border border-primary-700/60 bg-primary-900/40 p-3">
                  <div className="text-xs text-primary-300 font-semibold">已删除订单</div>
                  <div className="flex items-start gap-3 mt-2 min-w-0">
                    <div className={TOOL_BOOKING_THUMB}>
                      {deletedBooking?.cabins?.image ? (
                        <Image
                          src={deletedBooking.cabins.image}
                          alt={deletedBooking.cabins?.name ? `Cabin ${deletedBooking.cabins.name}` : "Cabin"}
                          fill
                          className="object-cover"
                          sizes="(max-width: 420px) 30vw, 140px"
                        />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-primary-100 truncate">
                        Cabin {deletedBooking?.cabins?.name}
                      </div>
                      <div className="text-xs text-primary-400 mt-1">
                        {deletedBooking?.startDate} → {deletedBooking?.endDate}
                      </div>
                      <div className="text-sm text-accent-400 mt-2 font-semibold">
                        {formatMoney(deletedBooking?.totalPrice)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {remainingBookings.length === 0 ? (
                <p className="text-xs text-primary-400">删除后没有剩余预订。</p>
              ) : (
                <>
                  {currentBooking && (
                    <div className="rounded-xl border border-primary-700/60 bg-primary-900/40 p-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={TOOL_BOOKING_THUMB}>
                          {currentBooking?.cabins?.image ? (
                            <Image
                              src={currentBooking.cabins.image}
                              alt={currentBooking.cabins?.name ? `Cabin ${currentBooking.cabins.name}` : "Cabin"}
                              fill
                              className="object-cover"
                              sizes="(max-width: 420px) 30vw, 140px"
                            />
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-primary-100 truncate">
                            {currentBooking?.numNights} nights in Cabin {currentBooking?.cabins?.name}
                          </div>
                          <div className="text-xs text-primary-400 mt-1">
                            {currentBooking?.startDate} → {currentBooking?.endDate}
                          </div>
                          <div className="text-xs text-primary-300 mt-2">
                            {currentBooking?.numGuests} 位住客
                          </div>
                          <div className="text-sm text-accent-400 mt-2 font-semibold">
                            {formatMoney(currentBooking?.totalPrice)}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end mt-3">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                          onClick={() => {
                            const bookingId = currentBooking?.id;
                            if (!bookingId) return;
                            if (!confirm("确定删除这条预订订单吗？")) return;
                            sendMessage(
                              "删除预订：请调用 `delete_booking`。参数如下：\n" +
                                JSON.stringify({ bookingId })
                            );
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )}

                  {remainingBookings.length > 1 && (
                    <ToolCarouselNav
                      index={bookingIndex}
                      total={remainingBookings.length}
                      onPrev={() => setBookingIndex((i) => Math.max(0, i - 1))}
                      onNext={() =>
                        setBookingIndex((i) =>
                          Math.min(remainingBookings.length - 1, i + 1)
                        )
                      }
                      prevLabel="上一笔预订"
                      nextLabel="下一笔预订"
                      align="end"
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* 兜底 */}
          {tool.name !== "search_available_cabins" &&
            tool.name !== "create_booking" &&
            tool.name !== "get_my_bookings" &&
            tool.name !== "delete_booking" && (
              <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-primary-400 border border-primary-700/60 rounded-lg px-2 py-2">
                {JSON.stringify(output, null, 2)}
              </pre>
            )}
        </div>
      )}

      {tool.status === "error" && (
        <div className="border-t border-primary-700/60 px-2.5 pb-2.5 pt-1.5 @lg/msglist:px-2 @lg/msglist:pb-2 @lg/msglist:pt-1">
          <p className="text-xs text-red-300 whitespace-pre-wrap break-words">
            {tool.error ?? "工具执行失败"}
          </p>
        </div>
      )}
    </div>
  );
}