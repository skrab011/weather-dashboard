type Req = { method?: string; query?: Record<string, string | string[]> };
type Res = { status: (c: number) => Res; json: (b: unknown) => void; setHeader: (n: string, v: string) => void };

export default async function handler(_req: Req, res: Res): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, msg: "brief stub" });
}
