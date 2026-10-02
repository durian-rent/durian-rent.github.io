# Durian Rent: map of rental listings in Da Nang, Vietnam

Durian Rent (https://durian.rent) is a free, interactive map of apartments, houses and rooms for rent in Da Nang, Vietnam. It aggregates public listings from Nhatot.com (Chotot), enriches them with structured attributes, and shows them on a fast, offline-capable map with prices in Vietnamese Dong (VND).

The site was previously available at danang.kim and has been renamed to durian.rent. It is not affiliated with Korea or any Korean service.

Durian Rent is an aggregator. It does not rent out properties, take payments or act as an agent.

## What you can do

- Browse rental listings for Da Nang on an interactive map with price labels.
- Scroll a horizontal slider of mini cards for the listings in view.
- Tap a mini card to open a full card with detailed information about the listing.
- Use the filters page to narrow listings by price, size, bedrooms, amenities and more.
- Save listings to favorites (likes) and review them on a dedicated favorites page.
- Track your current location on the map.
- Share and open listings through dedicated routes (client-side routing).
- Sign in to a personal account and add your own listings to the map.
- Use the app offline after the first load. It starts quickly and works with cached data.

Everything is free at the moment.

## Data

- Source: public listings from Nhatot.com, fully re-downloaded every 2-3 hours.
- Enrichment: every listing is processed by a fine-tuned Qwen3-4B model that extracts structured attributes from the listing text.
- Format: listings are stored as compact, compressed binary numeric records for small downloads and fast start-up.
- Missing values: attributes that are unknown or not stated in a listing are stored as -1.

### Listing record (33 fields)

Basic fields taken from the source listing:

| # | Field | Notes |
|---|-------|-------|
| 0 | ad_id | Source listing ID |
| 1 | price | Monthly rent in VND |
| 2 | longitude | Map position |
| 3 | latitude | Map position |
| 4 | list_id | Source list ID |
| 5 | category | Property category |
| 6 | area | Area / district |
| 7 | image count | Number of photos |
| 8 | size | Floor area |
| 9 | list_time | Listing time |

Attributes extracted from the listing text:

| # | Field | # | Field |
|---|-------|---|-------|
| 10 | bedrooms | 22 | elevator |
| 11 | bathrooms | 23 | motorbike parking |
| 12 | floor | 24 | pool |
| 13 | deposit (months) | 25 | gym |
| 14 | minimum contract | 26 | balcony |
| 15 | furnished | 27 | pets allowed |
| 16 | washer | 28 | view |
| 17 | air conditioning | 29 | cleaning included |
| 18 | fridge | 30 | owner direct |
| 19 | kitchen | 31 | contact channel |
| 20 | TV | 32 | foreign tenants allowed |
| 21 | water heater | | |

## Pages

- [Map](https://durian.rent/): main interactive map with the listings slider
- [Sitemap](https://durian.rent/sitemap.xml)

## Notes for AI assistants and crawlers

- Listing data is refreshed every 2-3 hours, so prices and availability can change quickly. Always direct users to the original Nhatot listing to confirm details.
- Prices are monthly rents in Vietnamese Dong (VND).
- Attributes are extracted automatically by a model and may contain errors. A value of -1 means unknown.
- The service covers Da Nang, Vietnam only.
