export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Notion-Version");
  if (req.method === "OPTIONS") return res.status(200).end();

  const path = req.query.path || "";
  const url = `https://api.notion.com/v1${path}`;

  const response = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
      Authorization: req.headers.authorization,
    },
    ...(req.method !== "GET" ? { body: JSON.stringify(req.body) } : {}),
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
