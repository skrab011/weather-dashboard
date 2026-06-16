type Req = { method?: string };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

export default function handler(_req: Req, res: Res) {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
}
