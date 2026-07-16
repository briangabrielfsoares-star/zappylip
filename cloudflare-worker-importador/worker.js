const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function cors(origin = "*") {
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function reply(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

function cleanText(value) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function unique(values) {
  return [...new Set((values || []).map(cleanText).filter(Boolean))];
}

function shopeePrice(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 100000 ? n / 100000 : n;
}

function extractIds(input) {
  let decoded = String(input || "");
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  const patterns = [
    /-i\.(\d+)\.(\d+)/i,
    /[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i,
    /[?&]shop_id=(\d+).*?[?&]item_id=(\d+)/i,
    /\/product\/(\d+)\/(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) return { shopId: match[1], itemId: match[2] };
  }
  return null;
}

async function resolveShortUrl(url) {
  if (!/shp\.ee|s\.shopee/i.test(url)) return url;
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36" }
  });
  return response.url || url;
}

function browserHeaders(referer) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
    "Referer": referer,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "X-API-SOURCE": "pc"
  };
}

async function fetchJson(url, referer) {
  const response = await fetch(url, { headers: browserHeaders(referer), redirect: "follow" });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { response, data, text };
}

function normalizeItem(raw) {
  if (!raw) return null;
  return raw.data?.item || raw.data || raw.item || raw;
}

async function getShopeeItem(ids, referer) {
  const endpoints = [
    `https://shopee.com.br/api/v4/pdp/get_pc?item_id=${ids.itemId}&shop_id=${ids.shopId}`,
    `https://shopee.com.br/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`,
    `https://mall.shopee.com.br/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`
  ];
  const attempts = [];
  for (const endpoint of endpoints) {
    try {
      const result = await fetchJson(endpoint, referer);
      attempts.push({ endpoint, status: result.response.status });
      if (result.response.ok) {
        const item = normalizeItem(result.data);
        if (item?.name) return { item, attempts };
      }
    } catch (error) {
      attempts.push({ endpoint, error: error.message });
    }
  }
  return { item: null, attempts };
}

function attributeValue(item, names) {
  const attrs = item.attributes || item.attributes_new || [];
  for (const attr of attrs) {
    const name = cleanText(attr.name || attr.display_name).toLowerCase();
    if (!names.some(n => name.includes(n))) continue;
    const value = attr.value || attr.value_name || attr.values?.map(v => v.name || v.value).join(", ");
    if (value) return cleanText(value);
  }
  return "";
}

function imageUrl(id) {
  const value = cleanText(id);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://down-br.img.susercontent.com/file/${value}`;
}

function parseVariations(item) {
  const tiers = item.tier_variations || item.tier_variation || [];
  const colors = [];
  const sizes = [];
  const others = [];
  for (const tier of tiers) {
    const label = cleanText(tier.name).toLowerCase();
    const options = (tier.options || tier.option_list || []).map(o => typeof o === "string" ? o : (o.option || o.name || o.value));
    if (/cor|color|estampa/.test(label)) colors.push(...options);
    else if (/tamanho|size|numera|voltagem|capacidade/.test(label)) sizes.push(...options);
    else others.push(...options);
  }
  return { colors: unique(colors), sizes: unique(sizes), others: unique(others) };
}

function parseVideos(item) {
  const candidates = [
    ...(item.video_info_list || []),
    ...(item.video_info ? [item.video_info] : []),
    ...(item.videos || [])
  ];
  const urls = [];
  for (const video of candidates) {
    if (typeof video === "string") urls.push(video);
    else urls.push(video.video_url, video.url, ...(video.video_url_list || []));
  }
  return unique(urls);
}

function categoryName(item) {
  const cats = item.categories || item.category_list || [];
  const last = cats[cats.length - 1] || {};
  return cleanText(last.display_name || last.cat_name || last.name || item.category) || "Outros";
}

function buildProduct(item, sourceUrl) {
  const variations = parseVariations(item);
  const rawImages = item.images || item.image_list || (item.image ? [item.image] : []);
  const images = unique(rawImages.map(imageUrl)).slice(0, 8);
  const price = shopeePrice(item.price_min || item.price || item.price_max || item.models?.[0]?.price);
  const oldPrice = shopeePrice(item.price_before_discount || item.price_max_before_discount || item.price_min_before_discount);
  const rating = Number(item.item_rating?.rating_star || item.rating_star || item.rating || 0);
  return {
    sourceUrl,
    name: cleanText(item.name),
    description: cleanText(item.description || item.description_plain || ""),
    price,
    oldPrice,
    category: categoryName(item),
    brand: attributeValue(item, ["marca", "brand"]) || cleanText(item.brand) || "Sem marca",
    stock: Number(item.stock || item.normal_stock || item.models?.reduce((sum, model) => sum + Number(model.stock || 0), 0) || 0),
    sold: Number(item.historical_sold || item.sold || item.global_sold || 0),
    rating: Number.isFinite(rating) ? Number(rating.toFixed(1)) : 0,
    colors: variations.colors,
    sizes: variations.sizes.length ? variations.sizes : variations.others,
    images,
    videos: parseVideos(item),
    measurements: attributeValue(item, ["medida", "dimens", "tamanho do produto"])
  };
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "*";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const origin = allowedOrigin === "*" || allowedOrigin === requestOrigin ? requestOrigin : allowedOrigin;
    const route = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });

    if (request.method === "GET" && (route.pathname === "/" || route.pathname === "/health")) {
      return reply({ ok: true, service: "RedDrop Importador Shopee", version: "2.0.0", route: "POST /import" }, 200, origin);
    }

    if (request.method !== "POST" || route.pathname !== "/import") {
      return reply({ ok: false, error: "Use POST /import." }, 404, origin);
    }

    try {
      const body = await request.json().catch(() => ({}));
      const inputUrl = cleanText(body.url);
      if (!/^https?:\/\//i.test(inputUrl) || !/shopee|shp\.ee/i.test(inputUrl)) {
        return reply({ ok: false, error: "Cole um link válido de produto da Shopee." }, 400, origin);
      }

      const resolvedUrl = await resolveShortUrl(inputUrl);
      const ids = extractIds(resolvedUrl);
      if (!ids) {
        return reply({ ok: false, error: "Não identifiquei os códigos da loja e do produto. Use o link completo do anúncio." }, 422, origin);
      }

      const result = await getShopeeItem(ids, resolvedUrl);
      if (!result.item) {
        return reply({
          ok: false,
          error: "A Shopee bloqueou a leitura automática deste anúncio. Tente novamente em alguns minutos ou cadastre manualmente.",
          diagnostic: { shopId: ids.shopId, itemId: ids.itemId, attempts: result.attempts }
        }, 502, origin);
      }

      const product = buildProduct(result.item, resolvedUrl);
      if (!product.name) return reply({ ok: false, error: "O anúncio respondeu sem nome de produto." }, 502, origin);

      return reply({ ok: true, product, diagnostic: { shopId: ids.shopId, itemId: ids.itemId } }, 200, origin);
    } catch (error) {
      return reply({ ok: false, error: error?.message || "Falha inesperada no importador." }, 500, origin);
    }
  }
};
