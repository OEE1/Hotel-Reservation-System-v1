"use client";

import { useMemo, useState } from "react";

type BookingModalProps = {
  cabinId: number;
  checkIn: string;
  checkOut: string;
  maxCapacity: number;
  initialNumGuests?: number;
  sendMessage: (text: string) => Promise<void>;
  onClose: () => void;
};

export function ChatBookingModal({
  cabinId,
  checkIn,
  checkOut,
  maxCapacity,
  initialNumGuests,
  sendMessage,
  onClose,
}: BookingModalProps) {
  const safeMax = Math.max(1, maxCapacity ?? 1);
  const [numGuests, setNumGuests] = useState<number>(
    Math.min(Math.max(1, initialNumGuests ?? 1), safeMax)
  );
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [observations, setObservations] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const messagePayload = useMemo(() => {
    return {
      cabinId,
      checkIn,
      checkOut,
      numGuests,
      hasBreakfast,
      observations: observations.trim(),
    };
  }, [cabinId, checkIn, checkOut, numGuests, hasBreakfast, observations]);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 强制让模型执行 create_booking（工具调用由服务端根据 TOOL_DEFINITIONS 触发）
      const text =
        "帮我预定：请调用 `create_booking`，并使用以下参数创建订单。参数如下：\n" +
        JSON.stringify(messagePayload);
      await sendMessage(text);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-primary-950 border border-primary-700 rounded-2xl w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary-700">
          <div className="text-sm font-semibold text-primary-100">
            预定确认
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-primary-400 hover:text-primary-100 transition-colors"
            aria-label="Close"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-primary-300">
            入住：{checkIn}　退房：{checkOut}
          </div>

          <div className="space-y-2">
            <label className="text-sm text-primary-200">入住人数</label>
            <select
              value={numGuests}
              onChange={(e) => setNumGuests(Number(e.target.value))}
              className="w-full px-4 py-3 bg-primary-800 text-primary-100 border border-primary-600 rounded-lg"
            >
              {Array.from({ length: safeMax }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "guest" : "guests"}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 text-sm text-primary-200">
            <input
              type="checkbox"
              checked={hasBreakfast}
              onChange={(e) => setHasBreakfast(e.target.checked)}
            />
            是否包含早餐
          </label>

          <div className="space-y-2">
            <label className="text-sm text-primary-200">备注（可选）</label>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Any pets, allergies, special requirements..."
              className="w-full min-h-[110px] px-4 py-3 bg-primary-800 text-primary-100 border border-primary-600 rounded-lg"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-primary-700 text-primary-200 hover:border-accent-500/60 hover:text-primary-100 transition-colors"
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-accent-500 text-primary-900 hover:bg-accent-600 disabled:opacity-50 transition-colors"
            >
              {submitting ? "提交中..." : "确认预定"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

