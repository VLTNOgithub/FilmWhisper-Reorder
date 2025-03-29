const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const path = require('path');
const express = require('express'); // Import Express

const manifest = {
  id: 'com.example.filmwhisper-reorder',
  version: '0.0.7',
  name: 'FilmWhisper Reorder',
  description: 'Moves FilmWhisper AI Recommendations to the very top, above Popular, when searching.',
  resources: ['catalog'],
  types: ['movie', 'series'],
  catalogs: [
    {
      id: 'movie-reordered',
      name: 'Movies - Reordered',
      type: 'movie',
      extraSupported: ['search'],
    },
    {
      id: 'series-reordered',
      name: 'Series - Reordered',
      type: 'series',
      extraSupported: ['search'],
    },
  ],
  behaviorHints: {
    configurable: false,
    adult: false,
  },
}

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(({ type, id, extra }) => {
    const upstreamAddonUrl = 'https://ai.filmwhisper.dev/manifest.json';
    let upstreamCatalogId;

    if (type === 'movie') {
        upstreamCatalogId = 'ai-recommendations-movie';
    } else if (type === 'series') {
        upstreamCatalogId = 'ai-recommendations-series';
    } else {
        return Promise.resolve({ metas: [] });
    }

    return fetch(upstreamAddonUrl)
      .then((response) => response.json())
      .then((upstreamManifest) => {
        const upstreamCatalog = upstreamManifest.catalogs.find(
          (catalog) => catalog.type === type && catalog.id === upstreamCatalogId
        );

        if (!upstreamCatalog) {
          return Promise.resolve({ metas: [] });
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

        return fetch(upstreamCatalogUrl)
          .then((response) => response.json())
          .then((upstreamResponse) => {
            let reorderedMetas = upstreamResponse.metas;
            if (extra && extra.search) {
              reorderedMetas = moveAbovePopular(reorderedMetas, type); //Call moveAbovePopular first

              reorderedMetas = moveToTop(reorderedMetas, type)  // Call move to top after
            }

            return { metas: reorderedMetas };
          })
          .catch((err) => {
            console.error('Error fetching upstream catalog:', err);
            return { metas: [] };
          });
      })
      .catch((err) => {
        console.error('Error fetching upstream manifest:', err);
        return { metas: [] };
      });
  });

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
    const targetMeta = metas.splice(targetIndex, 1)[0];
    metas.unshift(targetMeta);
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
        // "Popular" section not found, so nothing to move above
        return metas;
    }

    // Popular section is at the top, nothing to move.
    if(popularIndex === 0) return metas

    // Move everything before the "Popular" section to the very top
    const itemsBeforePopular = metas.slice(0, popularIndex); // Extract elements BEFORE "Popular"
    metas.splice(0, popularIndex); // Remove elements BEFORE "Popular"
    metas.unshift(...itemsBeforePopular); // Add elements to the start

    return metas;
}

const app = express(); // Create an Express app
app.use(express.static(path.join(__dirname, '/'))); // Serve static files from the root directory

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });

app.listen(process.env.PORT || 8080, () => {
  console.log('Website running on port 8080');
});