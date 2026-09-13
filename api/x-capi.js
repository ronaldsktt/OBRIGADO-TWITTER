import crypto from "crypto";

const PIXEL_ID = "rf6ha";
const TOKEN =
  process.env.X_PIXEL_TOKEN ||
  "Amfjd4qSvecvvJrrkmU0lR67ySytNbZGvKrx-JtDWeRo34_6CaQrPGA-pD7jYi2Bne63xMsPlw";

const ALLOWED = new Set(["tw-rf6ha-rf8gj", "tw-rf6ha-rf8wi"]);
const PURCHASE = "tw-rf6ha-rf8wi";

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return req.socket?.remoteAddress;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normEmail(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "";
  return s;
}

function e164Phone(raw) {
  if (typeof raw !== "string") return "";
  let d = raw.replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12 || d.length > 13) return "";
  return "+" + d;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }

  let data = req.body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      res.status(400).json({ ok: false });
      return;
    }
  }
  if (!data || typeof data !== "object") {
    res.status(400).json({ ok: false });
    return;
  }

  const eventId = data.eventId;
  const conversionId = data.conversionId;
  if (!ALLOWED.has(eventId) || typeof conversionId !== "string" || !conversionId || conversionId.length > 128) {
    res.status(400).json({ ok: false });
    return;
  }

  const twclid = typeof data.twclid === "string" ? data.twclid.trim().slice(0, 200) : "";
  const ip = clientIp(req);
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 512);
  const email = normEmail(data.email);
  const phone = e164Phone(data.phone);
  const identifiers = [];
  if (twclid) identifiers.push({ twclid });
  if (email) identifiers.push({ hashed_email: sha256(email) });
  if (phone) identifiers.push({ hashed_phone_number: sha256(phone) });
  if (ip && userAgent) identifiers.push({ ip_address: ip, user_agent: userAgent });
  if (!identifiers.length) {
    res.status(200).json({ ok: false });
    return;
  }

  const conversion = {
    conversion_time: new Date().toISOString(),
    event_id: eventId,
    conversion_id: conversionId.slice(0, 128),
    identifiers,
  };
  if (typeof data.eventSourceUrl === "string" && data.eventSourceUrl.trim()) {
    conversion.event_source_url = data.eventSourceUrl.trim().slice(0, 500);
  }

  if (eventId === PURCHASE) {
    const num = Number(String(data.value ?? "").replace(",", "."));
    if (Number.isFinite(num) && num > 0 && num < 1000) {
      conversion.value = Math.round(num * 100) / 100;
      conversion.price_currency = "BRL";
      conversion.number_items = 1;
    }
  }

  try {
    const r = await fetch(
      `https://ads-api.x.com/12/measurement/conversions/${PIXEL_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pixel-Token": TOKEN,
        },
        body: JSON.stringify({ conversions: [conversion] }),
      },
    );
    res.status(200).json({ ok: r.ok });
  } catch {
    res.status(200).json({ ok: false });
  }
}
