
var photos_cache
caches.open('photos').then(_ => photos_cache = _)

function cache_fetch(URL) {
    const [url, ver] = URL.split('?')
    
    return caches.open(url)
    .then(cache =>
        cache.keys()
        .then(keys => keys[0])
        .then(r => r?.url.endsWith(ver || '')
            ? cache.match(r)
            : Promise.resolve(r && cache.delete(r))
                .then(() => fetch(URL))
                .then(response => {
                    cache.put(URL, response.clone())
                    return response
                })
        )
    ).catch(e =>
        console.error(`cache_fetch(${URL})`, e) ||
        fetch(URL)
    )
}

const photo_priority = new Set()

function request_photo({url, retry}) {
    console.time(url)
    return fetch(
        url,
        {
            mode: 'no-cors',
            priority: photo_priority.has(url) ? 'high' : 'low'
        }
    )
    .then(r => {
        if (r.ok || r.type == 'opaque') {
            console.time(`photos_cache.put(${url})`)
            return photos_cache.put(url, r.clone())
            .then(
                () => {
                    console.timeEnd(`photos_cache.put(${url})`)
                    console.timeEnd(url)
                    return r
                },
                e => {
                    console.error('sw.js', '1. CacheStorage put', 'url:', url, 'error:', e, 'respond:', r, 'retry:', retry)
                    debugger
                    //here need retrun `r` anyway
                    console.timeEnd(`photos_cache.put(${url})`)
                    console.timeEnd(url)
                    return r
                }
            )
        }
    })
    .catch(e => {
        console.error('sw.js', '2. fetch(mode no-cors)', 'url:', url, 'error:', e)
        debugger
        if (retry > 0) {
            return request_photo({url, retry: retry - 1})
        } else {
            throw e // for fallback to /photo-default.jpg
        }
    })
}

self.addEventListener('message', ({data}) =>
    data.type == 'PHOTO_PRIORITY' &&
    photo_priority.add(data.url)
)

self.addEventListener('fetch', event => {
    const u = event.request.url
    if (u.includes('cdn.chotot.com') && u.endsWith('.jpg')) {
        event.respondWith(
            photos_cache.match(u)
            .then(cached_r =>
                cached_r || request_photo({url: u, retry: 2})
            )
            .catch(e => {
                console.error('sw.js', '3. JPG last catch - load default', e)
                return photos_cache.match('/photo-default.jpg') 
                .then(cached_r =>
                    cached_r || request_photo({url: '/photo-default.jpg', retry: 0})
                )
            })
        )
        return
    }
    
    if (event.request.url.includes('manifest.json')) {
        event.respondWith(
            cache_fetch(event.request.url)
        )
        return
    }

    if (event.request.url.includes('favicon.ico')) {
        event.respondWith(
            cache_fetch(event.request.url)
        )
        return
    }

    if (event.request.url.includes('icon-192.png')) {
        event.respondWith(
            cache_fetch(event.request.url)
        )
        return
    }

    if (event.request.url.includes('icon-512.png')) {
        event.respondWith(
            cache_fetch(event.request.url)
        )
        return
    }

    if (event.request.mode !== 'navigate')
        return

    if (new URL(event.request.url).pathname !== '/')
        return

    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone()
                caches.open('index').then(cache =>
                    cache.put('/', clone)
                )
                return response
            })
            .catch(() => caches.match('/'))
    )
})

self.addEventListener('install', event => {
    event.waitUntil(
        Promise.all([
            caches.open('index')
                .then(cache => cache.add('/')),
            caches.open('manifest.json')
                .then(cache => cache.add('manifest.json')),
            caches.open('icon-192.png')
                .then(cache => cache.add('icon-192.png')),
            caches.open('icon-512.png')
                .then(cache => cache.add('icon-512.png')),
            caches.open('favicon.ico')
                .then(cache => cache.add('favicon.ico'))
        ])
    )
    self.skipWaiting()
})