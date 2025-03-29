export const config = {
	compatibility_flags: ["nodejs_compat"]
  };
  
  export default {
	async fetch(request, env, ctx) {
	  // Log every request with detailed information
	  const url = new URL(request.url);
	  console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}${url.search}`);
	  
	  // Handle CORS preflight requests
	  if (request.method === "OPTIONS") {
		console.log("Handling OPTIONS preflight request");
		return handleCorsPreflightRequest();
	  }
	  
	  return handleRequest(request);
	}
  };
  
  function handleCorsPreflightRequest() {
	return new Response(null, {
	  status: 204, // No content
	  headers: {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Accept, Range",
		"Access-Control-Max-Age": "86400", // 24 hours
	  }
	});
  }
  
  async function handleRequest(request) {
	const url = new URL(request.url);
	const path = url.pathname;
  
	// Set standard headers for all responses
	const headers = {
	  "Content-Type": "application/json",
	  "Access-Control-Allow-Origin": "*",
	  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
	  "Access-Control-Allow-Headers": "Content-Type, Accept, Range",
	  "Cache-Control": "no-cache, no-store, must-revalidate"
	};
  
	// Manifest request
	if (path === "/" || path === "/manifest.json") {
	  console.log("Serving manifest");
	  return serveManifest(headers);
	}
	
	// Catalog request
	if (path.startsWith("/catalog/")) {
	  console.log("Serving catalog");
	  return serveCatalog(url, request, headers);
	}
	
	// Default response for unhandled routes
	console.log("Serving default response");
	return new Response(
	  JSON.stringify({
		message: "FilmWhisper Reorder API",
		status: "success",
		timestamp: new Date().toISOString()
	  }, null, 2),
	  { headers }
	);
  }
  
  function serveManifest(headers) {
	const manifest = {
	  id: "com.example.filmwhisper-reorder",
	  version: "0.0.7",
	  name: "FilmWhisper Reorder",
	  description: "Moves FilmWhisper AI Recommendations to the very top, above Popular, when searching.",
	  resources: ["catalog"],
	  types: ["movie", "series"],
	  catalogs: [
		{
		  id: "movie-reordered",
		  name: "Movies - Reordered",
		  type: "movie",
		  extraSupported: ["search"],
		},
		{
		  id: "series-reordered",
		  name: "Series - Reordered",
		  type: "series",
		  extraSupported: ["search"],
		},
	  ],
	  logo: "https://i.imgur.com/tijpFEd.png",
	  background: "https://i.imgur.com/QmCQZuY.jpg",
	  behaviorHints: {
		configurable: false,
		adult: false,
	  }
	};
	
	const jsonString = JSON.stringify(manifest, null, 2);
	console.log("Manifest content:", jsonString);
	
	return new Response(jsonString, { headers });
  }
  
  async function serveCatalog(url, request, headers) {
	// Parse the URL to get type and id
	const parts = url.pathname.split('/');
	const type = parts[2];
	const id = parts[3].split('.')[0];
	
	console.log(`Serving catalog for type: ${type}, id: ${id}`);
	
	// Get search parameters
	const searchParams = url.searchParams;
	const extra = {};
	for (const [key, value] of searchParams.entries()) {
	  extra[key] = value;
	  console.log(`Search param: ${key}=${value}`);
	}
	
	const upstreamAddonUrl = 'https://ai.filmwhisper.dev/manifest.json';
	let upstreamCatalogId;
  
	if (type === 'movie') {
	  upstreamCatalogId = 'ai-recommendations-movie';
	} else if (type === 'series') {
	  upstreamCatalogId = 'ai-recommendations-series';
	} else {
	  console.log(`Unknown type: ${type}`);
	  return new Response(JSON.stringify({ metas: [] }), { headers });
	}
  
	try {
	  console.log(`Fetching upstream manifest from: ${upstreamAddonUrl}`);
	  const manifestResponse = await fetch(upstreamAddonUrl);
	  
	  if (!manifestResponse.ok) {
		console.error(`Failed to fetch upstream manifest: ${manifestResponse.status} ${manifestResponse.statusText}`);
		return new Response(JSON.stringify({ 
		  error: 'Failed to fetch upstream manifest',
		  metas: [] 
		}), { 
		  status: 502,
		  headers 
		});
	  }
	  
	  const upstreamManifest = await manifestResponse.json();
	  
	  const upstreamCatalog = upstreamManifest.catalogs.find(
		(catalog) => catalog.type === type && catalog.id === upstreamCatalogId
	  );
  
	  if (!upstreamCatalog) {
		console.log(`Upstream catalog not found for type: ${type}, id: ${upstreamCatalogId}`);
		return new Response(JSON.stringify({ metas: [] }), { headers });
	  }
  
	  let upstreamCatalogUrl = upstreamAddonUrl.replace('/manifest.json', '');
	  upstreamCatalogUrl += `/catalog/${type}/${upstreamCatalog.id}.json`;
  
	  if (extra && Object.keys(extra).length > 0) {
		let extraParams = [];
		for (const key in extra) {
		  extraParams.push(`${key}=${encodeURIComponent(extra[key])}`);
		}
		upstreamCatalogUrl += `?${extraParams.join('&')}`;
	  }
  
	  console.log(`Fetching upstream catalog from: ${upstreamCatalogUrl}`);
	  const catalogResponse = await fetch(upstreamCatalogUrl);
	  
	  if (!catalogResponse.ok) {
		console.error(`Failed to fetch upstream catalog: ${catalogResponse.status} ${catalogResponse.statusText}`);
		return new Response(JSON.stringify({ 
		  error: 'Failed to fetch upstream catalog',
		  metas: [] 
		}), { 
		  status: 502,
		  headers 
		});
	  }
	  
	  const upstreamResponse = await catalogResponse.json();
	  
	  let reorderedMetas = upstreamResponse.metas;
	  if (extra && extra.search) {
		console.log(`Reordering results for search: ${extra.search}`);
		reorderedMetas = moveAbovePopular(reorderedMetas, type);
		reorderedMetas = moveToTop(reorderedMetas, type);
	  }
  
	  console.log(`Returning ${reorderedMetas.length} results`);
	  return new Response(JSON.stringify({ metas: reorderedMetas }), { headers });
	} catch (err) {
	  console.error('Error processing request:', err);
	  return new Response(JSON.stringify({ 
		error: 'An error occurred while processing the request',
		message: err.message,
		metas: [] 
	  }), {
		status: 500,
		headers
	  });
	}
  }
  
  function moveToTop(metas, type) {
	let targetName;
	if (type === 'movie') {
	  targetName = 'AI Recommendations - Movie';
	} else if (type === 'series') {
	  targetName = 'AI Recommendations - Series';
	} else {
	  return metas; // Unknown type, don't reorder
	}
  
	// Do nothing when the list is empty.
	if (metas.length === 0) return metas;
  
	let targetIndex = -1;
  
	for (let i = 0; i < metas.length; i++) {
	  if (metas[i].name === targetName) {
		targetIndex = i;
		break;
	  }
	}
  
	if (targetIndex !== -1) {
	  console.log(`Moving "${targetName}" from position ${targetIndex} to top`);
	  const targetMeta = metas.splice(targetIndex, 1)[0];
	  metas.unshift(targetMeta);
	} else {
	  console.log(`"${targetName}" not found in results`);
	}
  
	return metas;
  }
  
  function moveAbovePopular(metas, type) {
	let popularName;
	if (type === 'movie') {
	  popularName = 'Popular - Movie';
	} else if (type === 'series') {
	  popularName = 'Popular - Series';
	} else {
	  return metas;
	}
  
	let popularIndex = -1;
  
	for (let i = 0; i < metas.length; i++) {
	  if (metas[i].name === popularName) {
		popularIndex = i;
		break;
	  }
	}
  
	if (popularIndex === -1) {
	  console.log(`"${popularName}" section not found, nothing to move above`);
	  return metas;
	}
  
	if (popularIndex === 0) {
	  console.log(`"${popularName}" is already at the top, nothing to move`);
	  return metas;
	}
  
	console.log(`Moving items before "${popularName}" (at position ${popularIndex}) to the top`);
	const itemsBeforePopular = metas.slice(0, popularIndex);
	metas.splice(0, popularIndex);
	metas.unshift(...itemsBeforePopular);
  
	return metas;
  }
  