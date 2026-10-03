import { Locale } from "../../shared/locale";

export type Inline = string | { strong: string };

export interface EmailButton {
  label: string;
  url: string;
}

export interface EmailContent {
  locale: Locale;
  subject: string;
  preview: string;
  title: string;
  lead: Inline[];
  extra?: string;
  middle?:
    | { kind: "code"; code: string; note: string; button: EmailButton }
    | { kind: "action"; button: EmailButton }
    | { kind: "facts"; facts: { label: string; value: string[] }[] };
  box?: { heading: string; body: string; action?: EmailButton };
  fallbackLabel: string;
  footer: string;
  site: { label: string; url: string };
  contact: { label: string; address: string };
}

const LIGHT = {
  bg: "#fcf6ee",
  surface: "#fffefb",
  surface2: "#f5efe7",
  border: "#e4dfd7",
  borderStrong: "#c2bdb5",
  text: "#1c1812",
  text2: "#59544e",
  text3: "#646059",
  brand: "#4747ae",
  onBrand: "#ffffff",
  brandText: "#39359b",
} as const;

const DARK: Record<keyof typeof LIGHT, string> = {
  bg: "#0b0804",
  surface: "#15110c",
  surface2: "#1d1913",
  border: "#2a2620",
  borderStrong: "#413c36",
  text: "#f1eeea",
  text2: "#afaaa3",
  text3: "#8a857e",
  brand: "#8991ff",
  onBrand: "#090a21",
  brandText: "#b9c4ff",
};

const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const PREVIEW_FILLER = "&#847;&zwnj;&nbsp;".repeat(90);

const HEAD_STYLE = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
.lf-canvas{background-color:${DARK.bg}!important}
.lf-card{background-color:${DARK.surface}!important;border-color:${DARK.border}!important}
.lf-brand,.lf-link{color:${DARK.brandText}!important}
.lf-text{color:${DARK.text}!important}
.lf-muted{color:${DARK.text2}!important}
.lf-foot{color:${DARK.text3}!important}
.lf-code{background-color:${DARK.surface2}!important;color:${DARK.text}!important}
.lf-box{background-color:${DARK.surface2}!important}
.lf-rule{border-top-color:${DARK.border}!important}
.lf-btn{background-color:${DARK.brand}!important}
.lf-btn-label{color:${DARK.onBrand}!important}
.lf-btn2{background-color:${DARK.surface}!important;border-color:${DARK.borderStrong}!important}
.lf-btn2-label{color:${DARK.text}!important}
}
@media (max-width:480px){.lf-card-cell{padding:24px 16px!important}}`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const inlineHtml = (parts: Inline[]): string =>
  parts
    .map((part) =>
      typeof part === "string"
        ? escapeHtml(part)
        : `<strong style="font-weight:600">${escapeHtml(part.strong)}</strong>`,
    )
    .join("");

const inlineText = (parts: Inline[]): string =>
  parts.map((part) => (typeof part === "string" ? part : part.strong)).join("");

const paragraph = (html: string, size: 15 | 13, extraStyle = ""): string => {
  const tone =
    size === 15
      ? `class="lf-text" style="margin:0;font-family:${SANS};font-size:15px;line-height:1.5;color:${LIGHT.text};${extraStyle}"`
      : `class="lf-muted" style="margin:0;font-family:${SANS};font-size:13px;line-height:1.5;color:${LIGHT.text2};${extraStyle}"`;
  return `<p ${tone}>${html}</p>`;
};

const stack = (pieces: string[], gap: number): string =>
  `<table ${TABLE} width="100%">${pieces
    .map(
      (piece, index) =>
        `<tr><td style="padding-top:${index === 0 ? 0 : gap}px">${piece}</td></tr>`,
    )
    .join("")}</table>`;

const button = (action: EmailButton, secondary: boolean): string => {
  const cell = secondary
    ? `class="lf-btn2" bgcolor="${LIGHT.surface}" style="border-radius:10px;background-color:${LIGHT.surface};border:1px solid ${LIGHT.borderStrong};mso-padding-alt:14px 24px"`
    : `class="lf-btn" bgcolor="${LIGHT.brand}" style="border-radius:10px;background-color:${LIGHT.brand};mso-padding-alt:14px 24px"`;
  const label = secondary
    ? `class="lf-btn2-label" style="display:block;padding:14px 24px;font-family:${SANS};font-size:15px;line-height:1.5;font-weight:600;color:${LIGHT.text};text-decoration:none;text-align:center;border-radius:10px"`
    : `class="lf-btn-label" style="display:block;padding:14px 24px;font-family:${SANS};font-size:15px;line-height:1.5;font-weight:600;color:${LIGHT.onBrand};text-decoration:none;text-align:center;border-radius:10px"`;
  return `<table ${TABLE} width="100%"><tr><td align="center" ${cell}><a ${label} href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></td></tr></table>`;
};

const fallbackLink = (content: EmailContent, action: EmailButton): string =>
  paragraph(
    `${escapeHtml(content.fallbackLabel)} <a class="lf-link" href="${escapeHtml(action.url)}" style="color:${LIGHT.brandText};word-break:break-all">${escapeHtml(action.url)}</a>`,
    13,
  );

const unbroken = (chunks: string[]): string =>
  chunks
    .map(
      (chunk) => `<span style="white-space:nowrap">${escapeHtml(chunk)}</span>`,
    )
    .join(" ");

const facts = (rows: { label: string; value: string[] }[]): string =>
  `<table ${TABLE} width="100%">${rows
    .map((row, index) => {
      const rule = index === 0 ? "" : `border-top:1px solid ${LIGHT.border};`;
      const ruleClass = index === 0 ? "" : " lf-rule";
      return `<tr><th scope="row" class="lf-muted${ruleClass}" style="${rule}width:88px;padding:8px 12px 8px 0;font-family:${SANS};font-size:13px;line-height:1.5;font-weight:400;color:${LIGHT.text2};text-align:left;vertical-align:top">${escapeHtml(row.label)}</th><td class="lf-text${ruleClass}" style="${rule}padding:8px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${LIGHT.text}">${unbroken(row.value)}</td></tr>`;
    })
    .join("")}</table>`;

const middlePieces = (content: EmailContent): string[] => {
  const middle = content.middle;
  if (!middle) return [];
  if (middle.kind === "facts") return [facts(middle.facts)];
  if (middle.kind === "action") {
    return [button(middle.button, false), fallbackLink(content, middle.button)];
  }
  return [
    `<table ${TABLE} width="100%"><tr><td class="lf-code" align="center" bgcolor="${LIGHT.surface2}" style="padding:16px;border-radius:10px;background-color:${LIGHT.surface2};font-family:${MONO};font-size:32px;line-height:1.2;font-weight:600;letter-spacing:0.3em;color:${LIGHT.text};text-align:center">${escapeHtml(middle.code)}</td></tr></table>`,
    paragraph(escapeHtml(middle.note), 13),
    button(middle.button, false),
    fallbackLink(content, middle.button),
  ];
};

const box = (content: EmailContent): string[] => {
  if (!content.box) return [];
  const { heading, body, action } = content.box;
  const pieces = [
    `<h2 class="lf-text" style="margin:0;font-family:${SANS};font-size:15px;line-height:1.5;font-weight:600;color:${LIGHT.text}">${escapeHtml(heading)}</h2>`,
    paragraph(escapeHtml(body), 15),
    ...(action ? [button(action, true), fallbackLink(content, action)] : []),
  ];
  return [
    `<table ${TABLE} width="100%"><tr><td class="lf-box" bgcolor="${LIGHT.surface2}" style="padding:16px;border-radius:10px;background-color:${LIGHT.surface2}">${stack(pieces, 12)}</td></tr></table>`,
  ];
};

const footerLine = (content: EmailContent): string => {
  const link = (href: string, label: string): string =>
    `<a class="lf-foot" href="${escapeHtml(href)}" style="color:${LIGHT.text3};text-decoration:underline">${escapeHtml(label)}</a>`;
  return `Ledger Flow · ${link(content.site.url, content.site.label)} · ${escapeHtml(content.contact.label)} ${link(`mailto:${content.contact.address}`, content.contact.address)}`;
};

export function renderHtml(content: EmailContent): string {
  const card = stack(
    [
      `<p class="lf-brand" style="margin:0;font-family:${SANS};font-size:16px;line-height:1.5;font-weight:600;color:${LIGHT.brandText}">Ledger Flow</p>`,
      `<h1 class="lf-text" style="margin:0;font-family:${SANS};font-size:22px;line-height:1.3;font-weight:600;color:${LIGHT.text}">${escapeHtml(content.title)}</h1>`,
      paragraph(inlineHtml(content.lead), 15),
      ...(content.extra ? [paragraph(escapeHtml(content.extra), 13)] : []),
      ...middlePieces(content),
      ...box(content),
    ],
    16,
  );
  const footStyle = `margin:0;font-family:${SANS};font-size:12px;line-height:1.5;color:${LIGHT.text3}`;
  return `<!DOCTYPE html>
<html lang="${content.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<style>${HEAD_STYLE}</style>
</head>
<body class="lf-canvas" style="margin:0;padding:0;background-color:${LIGHT.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(content.preview)}${PREVIEW_FILLER}</div>
<table ${TABLE} width="100%" class="lf-canvas" bgcolor="${LIGHT.bg}" style="background-color:${LIGHT.bg}"><tr><td align="center" style="padding:24px 12px 32px">
<!--[if mso]><table ${TABLE} width="560" align="center"><tr><td><![endif]-->
<table ${TABLE} width="100%" class="lf-card" bgcolor="${LIGHT.surface}" style="max-width:560px;background-color:${LIGHT.surface};border:1px solid ${LIGHT.border};border-radius:14px"><tr><td class="lf-card-cell" style="padding:28px 24px">${card}</td></tr></table>
<table ${TABLE} width="100%" style="max-width:560px"><tr><td style="padding:16px 24px 0"><p class="lf-foot" style="${footStyle}">${escapeHtml(content.footer)}</p><p class="lf-foot" style="${footStyle};padding-top:6px">${footerLine(content)}</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
}

export function renderText(content: EmailContent): string {
  const middle = content.middle;
  const middleLines = !middle
    ? []
    : middle.kind === "code"
      ? [
          `    ${middle.code}`,
          "",
          middle.note,
          "",
          `${middle.button.label}: ${middle.button.url}`,
        ]
      : middle.kind === "action"
        ? [`${middle.button.label}: ${middle.button.url}`]
        : middle.facts.map((row) => `${row.label}: ${row.value.join(" ")}`);
  const boxLines = content.box
    ? [
        "",
        content.box.heading,
        content.box.body,
        ...(content.box.action
          ? [`${content.box.action.label}: ${content.box.action.url}`]
          : []),
      ]
    : [];
  return [
    "Ledger Flow",
    "",
    content.title,
    "",
    inlineText(content.lead),
    ...(content.extra ? ["", content.extra] : []),
    ...(middleLines.length > 0 ? ["", ...middleLines] : []),
    ...boxLines,
    "",
    "--",
    content.footer,
    `Ledger Flow · ${content.site.url} · ${content.contact.label} ${content.contact.address}`,
    "",
  ].join("\n");
}
