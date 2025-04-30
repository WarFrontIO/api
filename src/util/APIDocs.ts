import {registerRoute} from "../APIServer";
import {createReadStream, statSync} from "node:fs";
import {clientUrl, hostURL} from "./Conf";
import {TokenBucket} from "./TokenBucket";

const descRateLimit = new TokenBucket(5, 1);

registerRoute("/openapi.yaml", (req, res) => {
	res.writeHead(200, {
		"Content-Type": "application/yaml",
		"Access-Control-Allow-Origin": "*",
		"Content-Length": statSync("openapi.yaml").size
	});

	const readStream = createReadStream("openapi.yaml");
	readStream.pipe(res);
}, descRateLimit);

registerRoute("", (req, res) => {
	res.writeHead(200, {
		"Content-Type": "text/html"
	});

	/** @language html */
	res.write(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API Documentation</title>
<script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
</head>
<body>
<rapi-doc
	spec-url="openapi.yaml"
	theme="dark"
	primary-color="#457493"
	load-fonts="false"
	render-style="read"
	response-area-height="150px"
	show-method-in-nav-bar="as-colored-text"
	info-description-headings-in-navbar="true"
	show-header="false"
	show-curl-before-try="true"
	allow-server-selection="false"
	schema-style="table"
	allow-schema-description-expand-toggle="false"
	schema-description-expanded="true"
	default-schema-tab="schema"
	server-url="${hostURL}/"
	default-api-server="${hostURL}/"
>
	<div id="logo" slot="nav-logo" style="display: flex; align-items: center; background: var(--nav-bg-color)">
		<img src="${clientUrl}/dist/logo.png" alt="Logo" style="height: 75px; margin: 10px; cursor: pointer" onclick="window.location.href = '${clientUrl}'">
		<div style="font-size: 1.5em; line-height: 1em; color: white; text-align: center"><span style="display: inline-block; margin-right: 10px">Public API</span><span style="display: inline-block">Documentation</span></div>
	</div>
	<button slot="overview" class="m-btn thin-border" onclick='window.location.href ="openapi.yaml"'>Download OpenAPI Specification</button>

	<script>
	window.addEventListener("DOMContentLoaded", () => {
		const original = customElements.get("schema-table").prototype.render;
		customElements.get("schema-table").prototype.render = function(data) {
			const result = original.call(this, data);
			//Remove toolbar above schema (pretty useless and produces inconsistent margins)
			result.strings = [
				result.strings[0],
				result.strings[1],
				">",
				"",
				"",
				result.strings[5].replace("</div>\\n", ""),
				result.strings[6],
				result.strings[7]
			];
			result.strings.raw = result.strings;

			if (result.values[6].values[0].values[4] && result.values[6].values[0].values[4].values[0] && result.values[6].values[0].values[4].values[0].strings[0].includes("xxx-of-descr")) {
				//Add body label to primitives, fun magic numbers
				result.values[6].values[0].values[4].values[0].strings = [
					"<span class=\\"key-label\\">body</span>"
				];
				result.values[6].values[0].values[4].values[0].strings.raw = result.values[6].values[0].values[4].values[0].strings;
			}
			return result;
		};

		const doc = document.querySelector("rapi-doc");
		doc.addEventListener("spec-loaded", () => {
			document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...doc.shadowRoot.adoptedStyleSheets];

			//Add live preview for request body
			doc.shadowRoot.querySelectorAll("api-request").forEach(request => {
				request.shadowRoot.querySelectorAll("input").forEach(input => {
					if (input.getAttribute("data-ptype") === "form-urlencode") {
						input.addEventListener("input", (e) => {
							request.liveCURLSyntaxUpdate(request.getRequestPanel(e));
						});
					}
				});
			});

			const range = document.createRange();
			// Properly wrap long plain text examples
			const fragment = range.createContextualFragment(\`
<style>
pre {
	white-space: pre-wrap;
	word-break: break-all;
}
</style>
			\`);

			//Use more appropriate colors for response codes
			doc.shadowRoot.querySelectorAll("api-response").forEach(response => {
				//Replace inline codes with buttons
				const element = response.shadowRoot.querySelector("span");
				if (!isNaN(parseInt(element.innerText))) {
					const button = document.createElement("button");
					button.innerText = element.innerText;
					button.className = "m-btn small primary";
					button.style.margin = "8px 4px 0px 0px";
					element.replaceWith(button);
				}

				response.shadowRoot.querySelectorAll("button").forEach(button => {
					const code = parseInt(button.innerText);
					if (isNaN(code)) return;
					button.style.setProperty("--primary-color", code >= 500 ? "#9749d7" : code >= 400 ? "#c83446" : code >= 300 ? "#457493" : code >= 200 ? "#4f7348" : "#457493");
				});

				response.shadowRoot.append(fragment.cloneNode(true));
			});

			//Collapsable auth table
			const table = doc.shadowRoot.querySelector("#auth-table");
			table.style.display = "none";
			const button = document.createElement("button");
			button.className = "m-btn thin-border";
			button.style.marginRight = "10px";
			button.innerText = "SHOW AUTH";
			button.onclick = () => {
				if (table.style.display === "none") {
					table.style.display = "block";
					button.innerText = "HIDE AUTH";
				} else {
					table.style.display = "none";
					button.innerText = "SHOW AUTH";
				}
			};
			const row = doc.shadowRoot.querySelector("#auth > .small-font-size");
			row.insertBefore(button, row.firstChild);

			//Fix names of auth tokens
			table.querySelector("#security-scheme-userAuth").querySelector("span").innerText = "User Token (HTTP Bearer)";
			table.querySelector("#security-scheme-serviceAuth").querySelector("span").innerText = "Service Token (HTTP Bearer)";

			//Fix duplicate link handling
			doc.handleHref = () => {};

			//Insert Overview into navbar
			const overview = document.createElement("div");
			overview.id = "link-overview";
			overview.className = "nav-bar-info left-bar";
			overview.setAttribute("data-action", "navigate");
			overview.setAttribute("data-content-id", "overview");
			overview.setAttribute("tabindex", "0");
			overview.innerText = "Overview";
			const above = doc.shadowRoot.querySelector("#link-auth");
			above.parentNode.insertBefore(overview, above);

			//Remove useless operations tab
			doc.shadowRoot.querySelector("#link-operations-top").remove();
		});
	});

	if (window.innerWidth < 768) {
		document.querySelector("#logo").setAttribute("slot", "");
	}
	window.addEventListener("resize", () => {
		const logo = document.querySelector("#logo");
		if (logo) {
			if (window.innerWidth < 768) {
				logo.setAttribute("slot", "");
			} else {
				logo.setAttribute("slot", "nav-logo");
			}
		}
	});
	</script>
</rapi-doc>
</body>
</html>
	`);

	res.end();
}, descRateLimit);