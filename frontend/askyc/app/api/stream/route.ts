export async function POST(req: Request) {
  const body = await req.json();

  const backendRes = await fetch("http://localhost:8000/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  
  const stream = backendRes.body;

  return new Response(stream, {
    status: backendRes.status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
