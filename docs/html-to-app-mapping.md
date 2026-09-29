# HTML → APP Translation Map

How a normal HTML page becomes an APP manifest. **Principle: translate only what changes what an agent needs to _know_ or _do_. Drop everything that is layout, styling, or behavior implementation.**

## 1. What agents need to KNOW (→ state)

| HTML                 | Example                         | APP equivalent                                      |
| -------------------- | ------------------------------- | --------------------------------------------------- |
| Heading / title text | `<h1>Available Flights</h1>`    | `page.title`                                        |
| Price text           | `£845.00`                       | `{type:"number", value:84500, scale:2, unit:"GBP"}` |
| Table data           | `<table><tr><td>EK001</td>...`  | `{type:"table", fields:{...}, value:[[...]]}`       |
| List data            | `<ul><li>Item</li></ul>`        | `{type:"array", value:[...]}`                       |
| Status/state text    | "Booked", "In stock", "Pending" | `{type:"enum", value:"booked", options:[...]}`      |
| Dates                | "15 Aug 2026"                   | `{type:"date", value:"2026-08-15"}`                 |
| Counts/quantities    | "12 seats left"                 | `{type:"number", value:12}`                         |
| Image/file           | `<img src="/qr.png">`           | `{type:"file", value:{url, name, mime}}`            |
| Page description     | `<meta name="description">`     | `page.description`                                  |
| Language             | `<html lang="en">`              | `page.language`                                     |
| Empty state          | no results                      | `{type:"array", value:[]}` or null node             |

## 2. What agents need to DO (→ actions)

| HTML                    | Example                                  | APP equivalent                                            |
| ----------------------- | ---------------------------------------- | --------------------------------------------------------- |
| Form with inputs        | `<input type="number" name="max_price">` | action `input.max_price` `{type:"number", min:0}`         |
| Select dropdown         | `<select><option>LHR</option></select>`  | param `{type:"enum", options:["LHR","DXB",...]}`          |
| Text field              | `<input type="text" name="name">`        | param `{type:"string", required:true, max_length:100}`    |
| Checkbox/radio          | `<input type="checkbox">`                | param `{type:"boolean"}` or `{type:"enum"}`               |
| Submit button           | `<button type="submit">Search</button>`  | action with `input` schema + `side_effect`                |
| Book/buy/delete         | `<button>Book</button>`                  | action `{kind:"mutate", side_effect:"financial"}`         |
| Navigation link         | `<a href="/booking/1">`                  | `navigation` item or `output.navigates_to`                |
| Link that switches view | `<a href="?sort=price">`                 | `{kind:"query", idempotent:true}` action                  |
| JS button behavior      | `onclick="applyFilters()"`               | declared action `filter` with typed params                |
| Confirmation dialog     | JS confirm()                             | `requires_confirmation` + `side_effect` class             |
| File upload             | `<input type="file">`                    | param `{type:"string", upload:true}` + multipart          |
| Logout/delete account   | `<button>Delete</button>`                | `{side_effect:"destructive", requires_confirmation:true}` |

## 3. What agents need to FIND (→ discovery)

| HTML                                 | APP equivalent                           |
| ------------------------------------ | ---------------------------------------- |
| `<link rel="agent-page" href="...">` | `/.well-known/agent-page` (canonical)    |
| Sitemap / robots.txt                 | `well-known` capabilities + `entry_urls` |

## 4. What to DROP entirely (agents never see it)

| HTML                                                                                     | Why it's dropped                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `<div>`, `<span>`, `<section>`, `<article>`, `<main>`, `<header>`, `<footer>` (wrappers) | Layout containers — renderer's job, not semantics |
| `<style>`, CSS classes, flex, grid, spacing                                              | Visual layer — rebuilt from presentation hints    |
| `<script>`, `<noscript>`                                                                 | Behavior — replaced by declarative actions        |
| Analytics/tracking (GA, pixels, consent banners)                                         | Irrelevant to agents                              |
| `<b>`, `<i>`, `<em>`, `<strong>`, `<u>`                                                  | Presentational emphasis                           |
| `<img>` purely decorative, icons, SVGs                                                   | No semantic value                                 |
| Hidden/decoy elements, honeypots                                                         | Noise                                             |
| `aria-*` labels, alt text (in HTML form)                                                 | Renderer supplies accessibility from state/labels |
| Pagination links as `<a>` chains                                                         | `pagination: {cursor, has_more, total}`           |
| Loading spinners, skeletons                                                              | async actions + `operation_status`                |

## 5. The translation test

> **If an element doesn't change what an agent needs to know or do, it doesn't belong in the manifest.**

- A `<table>` of flights → YES, typed table node.
- A `<div class="results-wrapper">` around it → NO.
- A price in a `<td>` → YES, typed number with unit + scale.
- A `<button onclick="sort()">` → YES, declared query action.
- The `<style>` that makes the button blue → NO.

## 6. Worked example (same content, two forms)

**HTML:**

```html
<div class="flight-card">
  <h3>Emirates EK001</h3>
  <span class="price">£845.00</span>
  <span class="duration">435 min</span>
  <button onclick="book('fl-001')">Book</button>
</div>
```

**APP:**

```json
{
  "type": "table",
  "fields": {
    "id": "string",
    "airline": "string",
    "flight_no": "string",
    "price": "number",
    "duration": "number"
  },
  "value": [["fl-001", "Emirates", "EK001", 84500, 435]],
  "pagination": { "cursor": null, "has_more": false, "total": 1 }
}
```

The agent gets the flight number, price (typed, in minor units), and duration — and the `book` action is declared elsewhere with its params. It never sees `.flight-card`, `.price`, or the onclick handler.

---

_This map is the migration guide for existing HTML sites: translate §1-3, drop §4, run the §5 test on every element._
