import process from "process";

async function purgeCloudflareCache() {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !token) {
    console.log("deploy:purge skipped (missing CLOUDFLARE_ZONE_ID/CLOUDFLARE_API_TOKEN)");
    return;
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ purge_everything: true }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cloudflare purge failed: ${response.status} ${body}`);
  }
  console.log("Cloudflare cache purge complete");
}

purgeCloudflareCache().catch((err) => {
  console.error(err);
  process.exit(1);
});
