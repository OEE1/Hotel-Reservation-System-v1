// lib/ai/tools/index.ts
// 工具定义（function schema）+ 执行函数
// guestId 由服务端注入，不出现在 schema 里，防止 prompt injection 越权

// Reuse the project's existing Supabase client (it already reads env vars).
// Keeping this minimal avoids introducing a new supabase server helper module.
import { supabase as supabaseClient } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// 工具执行上下文（服务端注入，不经过 AI）
// ─────────────────────────────────────────────────────────────────────────────
export interface ToolContext {
  guestId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DeepSeek / OpenAI function calling schema
// ─────────────────────────────────────────────────────────────────────────────
export const TOOL_DEFINITIONS = [
  // ── D1-1: 查询可用房间 ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "search_available_cabins",
      description:
        "根据入住/退房日期和人数，查询当前可预订的房间列表，包含价格、容量和描述。",
      parameters: {
        type: "object",
        properties: {
          checkIn: {
            type: "string",
            format: "date",
            description: "入住日期，ISO 格式 YYYY-MM-DD",
          },
          checkOut: {
            type: "string",
            format: "date",
            description: "退房日期，ISO 格式 YYYY-MM-DD",
          },
          numGuests: {
            type: "integer",
            minimum: 1,
            description: "入住人数",
          },
        },
        required: ["checkIn", "checkOut", "numGuests"],
      },
    },
  },

  // ── D1-2: 创建预订 ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "为当前登录客人创建预订。调用前必须已通过 search_available_cabins 确认房间可用，并经过多轮对话收集完所有必要信息。",
      parameters: {
        type: "object",
        properties: {
          cabinId: {
            type: "integer",
            description: "要预订的房间 ID",
          },
          checkIn: {
            type: "string",
            format: "date",
            description: "入住日期，ISO 格式 YYYY-MM-DD",
          },
          checkOut: {
            type: "string",
            format: "date",
            description: "退房日期，ISO 格式 YYYY-MM-DD",
          },
          numGuests: {
            type: "integer",
            minimum: 1,
            description: "入住人数",
          },
          hasBreakfast: {
            type: "boolean",
            description: "是否包含早餐",
          },
          observations: {
            type: "string",
            description: "客人备注（可选）",
          },
        },
        required: [
          "cabinId",
          "checkIn",
          "checkOut",
          "numGuests",
          "hasBreakfast",
        ],
      },
    },
  },

  // ── D2-1: 查询我的预订列表 ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_my_bookings",
      description: "查询当前登录客人的所有预订记录，包含状态和费用摘要。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },

  // ── D2-2: 查询单条预订详情 ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_booking_detail",
      description: "查询某条预订的完整详情，只能查询属于当前登录客人的预订。",
      parameters: {
        type: "object",
        properties: {
          bookingId: {
            type: "integer",
            description: "预订 ID",
          },
        },
        required: ["bookingId"],
      },
    },
  },

  // ── D3: 费用计算 ────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "calculate_price",
      description:
        "根据房间、住宿天数、人数和是否含早餐，计算预订的费用明细（不写入数据库）。",
      parameters: {
        type: "object",
        properties: {
          cabinId: {
            type: "integer",
            description: "房间 ID",
          },
          numNights: {
            type: "integer",
            minimum: 1,
            description: "住宿天数",
          },
          numGuests: {
            type: "integer",
            minimum: 1,
            description: "入住人数",
          },
          hasBreakfast: {
            type: "boolean",
            description: "是否包含早餐",
          },
        },
        required: ["cabinId", "numNights", "numGuests", "hasBreakfast"],
      },
    },
  },

  // ── D4: 删除预订 ────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "delete_booking",
      description:
        "删除当前登录客人的指定预订，并返回被删除的订单详情以及更新后的预订列表。",
      parameters: {
        type: "object",
        properties: {
          bookingId: {
            type: "integer",
            description: "要删除的预订 ID",
          },
        },
        required: ["bookingId"],
      },
    },
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 工具执行入口
// ─────────────────────────────────────────────────────────────────────────────
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  switch (name) {
    case "search_available_cabins":
      return searchAvailableCabins(
        args as unknown as SearchAvailableCabinsArgs,
        ctx
      );
    case "create_booking":
      return createBooking(args as unknown as CreateBookingArgs, ctx);
    case "get_my_bookings":
      return getMyBookings(ctx);
    case "get_booking_detail":
      return getBookingDetail(args as unknown as GetBookingDetailArgs, ctx);
    case "calculate_price":
      return calculatePrice(args as unknown as CalculatePriceArgs);
    case "delete_booking":
      return deleteBooking(args as unknown as DeleteBookingArgs, ctx);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具实现
// ─────────────────────────────────────────────────────────────────────────────

interface SearchAvailableCabinsArgs {
  checkIn: string;
  checkOut: string;
  numGuests: number;
}

async function searchAvailableCabins(
  { checkIn, checkOut, numGuests }: SearchAvailableCabinsArgs,
  _ctx: ToolContext
) {
  const supabase = supabaseClient;

  // 计算住宿天数
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const numNights = Math.round(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 查询系统设置（minBookingLength / maxBookingLength）
  const { data: settings } = await supabase
    .from("settings")
    .select("minBookingLength, maxBookingLength, breakfastPrice")
    .single();

  if (!settings) throw new Error("无法读取系统设置");

  if (numNights < settings.minBookingLength) {
    return {
      error: `最少需要住 ${settings.minBookingLength} 晚`,
      available: false,
    };
  }
  if (numNights > settings.maxBookingLength) {
    return {
      error: `最多只能住 ${settings.maxBookingLength} 晚`,
      available: false,
    };
  }

  // 找出日期冲突的 cabinId（排除已取消的预订）
  const { data: conflictBookings } = await supabase
    .from("bookings")
    .select("cabinId")
    .neq("status", "cancelled")
    .lt("startDate", checkOut)
    .gt("endDate", checkIn);

  const conflictCabinIds = new Set(
    (conflictBookings ?? []).map((b) => b.cabinId)
  );

  // 查询满足容量且未冲突的房间
  const { data: cabins, error } = await supabase
    .from("cabins")
    .select("id, name, maxCapacity, regularPrice, discount, description, image")
    .gte("maxCapacity", numGuests)
    .order("regularPrice", { ascending: true });

  if (error) throw new Error(error.message);

  const available = (cabins ?? [])
    .filter((c) => !conflictCabinIds.has(c.id))
    .map((c) => ({
      ...c,
      // 实付价格（含折扣）
      pricePerNight: c.regularPrice - (c.discount ?? 0),
      totalCabinPrice: (c.regularPrice - (c.discount ?? 0)) * numNights,
      numNights,
    }));

  return {
    available: true,
    cabins: available,
    numNights,
    breakfastPricePerPersonNight: settings.breakfastPrice,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

interface CreateBookingArgs {
  cabinId: number;
  checkIn: string;
  checkOut: string;
  numGuests: number;
  hasBreakfast: boolean;
  observations?: string;
}

async function createBooking(
  { cabinId, checkIn, checkOut, numGuests, hasBreakfast, observations }: CreateBookingArgs,
  ctx: ToolContext
) {
  const supabase = supabaseClient;

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const numNights = Math.round(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 读取系统设置（校验规则 + 早餐价格）
  const { data: settings } = await supabase
    .from("settings")
    .select("minBookingLength, maxBookingLength, maxGuestsPerBooking, breakfastPrice")
    .single();

  if (!settings) throw new Error("无法读取系统设置");

  // 校验住宿天数
  if (numNights < settings.minBookingLength || numNights > settings.maxBookingLength) {
    throw new Error(
      `住宿天数需在 ${settings.minBookingLength}~${settings.maxBookingLength} 晚之间`
    );
  }

  // 校验人数
  if (numGuests > settings.maxGuestsPerBooking) {
    throw new Error(`最多允许 ${settings.maxGuestsPerBooking} 人入住`);
  }

  // 读取房间价格
  const { data: cabin } = await supabase
    .from("cabins")
    .select("regularPrice, discount, maxCapacity, name, image, description")
    .eq("id", cabinId)
    .single();

  if (!cabin) throw new Error("房间不存在");
  if (numGuests > cabin.maxCapacity) {
    throw new Error(`该房间最多容纳 ${cabin.maxCapacity} 人`);
  }

  // 二次校验日期冲突（防并发）
  const { data: conflicts } = await supabase
    .from("bookings")
    .select("id")
    .eq("cabinId", cabinId)
    .neq("status", "cancelled")
    .lt("startDate", checkOut)
    .gt("endDate", checkIn)
    .limit(1);

  if (conflicts && conflicts.length > 0) {
    throw new Error("该房间在所选日期已被预订，请重新选择");
  }

  // 计算费用
  const cabinPrice = (cabin.regularPrice - (cabin.discount ?? 0)) * numNights;
  const extrasPrice = hasBreakfast
    ? settings.breakfastPrice * numNights * numGuests
    : 0;
  const totalPrice = cabinPrice + extrasPrice;

  // 写入预订
  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      guestId: parseInt(ctx.guestId),
      cabinId,
      startDate: checkIn,
      endDate: checkOut,
      numNights,
      numGuests,
      hasBreakfast,
      observations: observations ?? "",
      cabinPrice,
      extrasPrice,
      totalPrice,
      status: "unconfirmed",
      isPaid: false,
    })
    .select(
      "id, cabinId, status, startDate, endDate, numNights, numGuests, totalPrice, cabinPrice, extrasPrice, hasBreakfast, observations"
    )
    .single();

  if (error) throw new Error(error.message);

  return {
    success: true,
    booking: {
      ...booking,
      cabinName: cabin.name,
      cabinImage: cabin.image,
      cabinDescription: cabin.description,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

async function getMyBookings(ctx: ToolContext) {
  const supabase = supabaseClient;

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, cabinId, startDate, endDate, numNights, numGuests, totalPrice, status, isPaid, hasBreakfast, observations, cabins(name, image, description)"
    )
    .eq("guestId", ctx.guestId)
    .order("startDate", { ascending: false });

  if (error) throw new Error(error.message);

  return { bookings: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────────────────

interface GetBookingDetailArgs {
  bookingId: number;
}

async function getBookingDetail(
  { bookingId }: GetBookingDetailArgs,
  ctx: ToolContext
) {
  const supabase = supabaseClient;

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, startDate, endDate, numNights, numGuests, cabinPrice, extrasPrice, totalPrice, status, isPaid, hasBreakfast, observations, cabins(name, description)"
    )
    .eq("id", bookingId)
    .eq("guestId", ctx.guestId) // 关键：防止越权查询
    .single();

  if (error || !data) {
    throw new Error("预订不存在或无权查看");
  }

  return { booking: data };
}

// ─────────────────────────────────────────────────────────────────────────────

interface CalculatePriceArgs {
  cabinId: number;
  numNights: number;
  numGuests: number;
  hasBreakfast: boolean;
}

async function calculatePrice({
  cabinId,
  numNights,
  numGuests,
  hasBreakfast,
}: CalculatePriceArgs) {
  const supabase = supabaseClient;

  const [{ data: cabin }, { data: settings }] = await Promise.all([
    supabase
      .from("cabins")
      .select("regularPrice, discount, name")
      .eq("id", cabinId)
      .single(),
    supabase
      .from("settings")
      .select("breakfastPrice")
      .single(),
  ]);

  if (!cabin || !settings) throw new Error("无法读取房间或设置信息");

  const pricePerNight = cabin.regularPrice - (cabin.discount ?? 0);
  const cabinPrice = pricePerNight * numNights;
  const extrasPrice = hasBreakfast
    ? settings.breakfastPrice * numNights * numGuests
    : 0;
  const totalPrice = cabinPrice + extrasPrice;

  return {
    cabinName: cabin.name,
    pricePerNight,
    cabinPrice,
    extrasPrice,
    totalPrice,
    numNights,
    numGuests,
    hasBreakfast,
    breakdownNote: hasBreakfast
      ? `早餐费 = ${settings.breakfastPrice} × ${numNights}晚 × ${numGuests}人`
      : "不含早餐",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 删除预订工具实现

interface DeleteBookingArgs {
  bookingId: number;
}

async function deleteBooking(
  { bookingId }: DeleteBookingArgs,
  ctx: ToolContext
) {
  // 1) 校验归属并取回被删订单详情（含 cabin image/name）
  const { data: deleted, error: deletedError } = await supabaseClient
    .from("bookings")
    .select(
      "id, cabinId, startDate, endDate, numNights, numGuests, totalPrice, status, isPaid, hasBreakfast, observations, cabins(name, image, description)"
    )
    .eq("id", bookingId)
    .eq("guestId", ctx.guestId)
    .single();

  if (deletedError || !deleted) {
    throw new Error("预订不存在或无权删除");
  }

  // 2) 删除记录
  const { error: deleteError } = await supabaseClient
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("guestId", ctx.guestId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  // 3) 返回更新后的列表（用于前端轮播）
  const { data: remaining, error: remainingError } = await supabaseClient
    .from("bookings")
    .select(
      "id, cabinId, startDate, endDate, numNights, numGuests, totalPrice, status, isPaid, hasBreakfast, observations, cabins(name, image, description)"
    )
    .eq("guestId", ctx.guestId)
    .order("startDate", { ascending: false });

  if (remainingError) {
    throw new Error(remainingError.message);
  }

  return {
    deletedBooking: deleted,
    bookings: remaining ?? [],
  };
}