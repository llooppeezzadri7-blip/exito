import { httpJson } from "../core/http.js";

export interface AlertChannel {
  id: string;
  send(title: string, body: string): Promise<void>;
}

/** Telegram Bot API sendMessage (plain text, chunked at 4000 chars). */
export class TelegramChannel implements AlertChannel {
  readonly id = "telegram";
  constructor(private readonly token: string, private readonly chatId: string) {}
  async send(_title: string, body: string): Promise<void> {
    for (const chunk of chunks(body, 3900)) {
      await httpJson(`https://api.telegram.org/bot${this.token}/sendMessage`, { provider: "telegram", method: "POST", body: { chat_id: this.chatId, text: chunk, disable_web_page_preview: true }, retries: 2 });
    }
  }
}

/** Discord incoming webhook. */
export class DiscordChannel implements AlertChannel {
  readonly id = "discord";
  constructor(private readonly webhookUrl: string) {}
  async send(_title: string, body: string): Promise<void> {
    for (const chunk of chunks(body, 1900)) {
      const res = await fetch(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "```\n" + chunk + "\n```" }) });
      if (!res.ok && res.status !== 204) throw new Error(`discord webhook HTTP ${res.status}`);
    }
  }
}

/** Dashboard channel: alerts are already persisted; this just marks delivery. */
export class DashboardChannel implements AlertChannel {
  readonly id = "dashboard";
  async send(): Promise<void> {}
}

function chunks(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [""];
}
