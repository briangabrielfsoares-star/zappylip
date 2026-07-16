const cors = (origin = "*") => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
});

function json(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

function priceToBRL(value) {
  const n = Number(value || 0);
  return n > 10000 ? n / 100000 : n;
}

function extractIds(url) {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/-i\.(\d+)\.(\d+)/) || decoded.match(/[?&]shopid=(\d+).*?[?&]itemid=(\d+)/);
  return match ? { shopId: match[1], itemId: match[2] } : null;
}

async function resolveUrl(url) {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
  return response.url || url;
}

function getAttribute(item, name) {
  const attrs = item.attributes || [];
  const found = attrs.find(a => String(a.name || "").toLowerCase().includes(name));
  return found?.value || "";
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "*";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const origin = allowed === "*" || requestOrigin === allowed ? requestOrigin : allowed;
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const urlObj = new URL(request.url);
    if (request.method !== "POST" || urlObj.pathname !== "/import") return json({ ok:false, error:"Rota inválida." },404,origin);
    try {
      const body = await request.json();
      if (!/^https?:\/\//i.test(body.url || "")) return json({ ok:false,error:"Link inválido." },400,origin);
      const resolved = await resolveUrl(body.url);
      const ids = extractIds(resolved);
      if (!ids) return json({ ok:false,error:"Não consegui identificar o produto. Abra o anúncio completo da Shopee e copie o link novamente." },422,origin);
      const api = `https://shopee.com.br/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`;
      const response = await fetch(api, { headers: {
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Referer":resolved,
        "Accept":"application/json"
      }});
      if (!response.ok) throw new Error(`Shopee respondeu ${response.status}.`);
      const raw = await response.json();
      const item = raw.data || raw.item || raw;
      if (!item?.name) throw new Error("A Shopee não liberou os dados deste anúncio.");
      const tiers = item.tier_variations || [];
      const variationNames = tiers.map(t => String(t.name || "").toLowerCase());
      const colors = [];
      const sizes = [];
      tiers.forEach((tier,index) => {
        const options = (tier.options || []).map(String).filter(Boolean);
        const name = variationNames[index] || "";
        if (/cor|color/.test(name)) colors.push(...options);
        else if (/tamanho|size|numera/.test(name)) sizes.push(...options);
      });
      const imageIds = item.images || (item.image ? [item.image] : []);
      const images = imageIds.slice(0,8).map(id => `https://down-br.img.susercontent.com/file/${id}`);
      const videoCandidates = [
        ...(item.video_info_list || []),
        ...(item.video_info ? [item.video_info] : [])
      ];
      const videos = videoCandidates.map(v => v.video_url || v.video_url_list?.[0] || v.url).filter(Boolean);
      const price = priceToBRL(item.price_min || item.price || item.price_max);
      const oldPrice = priceToBRL(item.price_before_discount || item.price_max_before_discount || 0);
      const rating = Number(item.item_rating?.rating_star || item.rating_star || 0).toFixed(1);
      const category = item.categories?.at?.(-1)?.display_name || item.categories?.at?.(-1)?.cat_name || "Outros";
      const brand = getAttribute(item,"marca") || item.brand || "Sem marca";
      return json({ ok:true, product:{
        sourceUrl:resolved,name:item.name,description:item.description || "",price,oldPrice,
        category,brand,stock:item.stock || 0,sold:item.historical_sold || item.sold || 0,
        rating:Number(rating),colors:[...new Set(colors)],sizes:[...new Set(sizes)],images,videos,
        measurements:""
      }},200,origin);
    } catch (error) {
      return json({ ok:false,error:error.message || "Erro inesperado." },500,origin);
    }
  }
};
