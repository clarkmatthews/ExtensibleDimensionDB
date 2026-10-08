import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/help-tip";
import { ModuleDenied } from "@/components/module-denied";
import { regenerateApiSecret, saveApiEndpoint, setApiEndpointActive } from "@/lib/api-actions";
import { dateKey } from "@/lib/api-share";
import { canEditModule, canViewModule, loadAccess } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

export default async function ApiConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canViewModule(access, "API_CONFIG")) return <ModuleDenied />;
  const canEdit = canEditModule(access, "API_CONFIG");
  const params = await searchParams;
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const [categories, endpoints] = await Promise.all([
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.apiEndpoint.findMany({
      orderBy: { name: "asc" },
      include: {
        categories: true,
        fields: true,
        logs: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    }),
  ]);
  const saved =
    params.saved === "secret" ? "Secret regenerated. Copy the new key and share it again." : params.saved ? "API endpoint saved." : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center text-2xl font-semibold">
          API Config
          <HelpTip text="Define read-only endpoints that a third party can call. Each endpoint has its own URL and secret. The response includes the selected attribute definitions and the active dimension values." />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Share the URL and the secret. Callers send the secret as <span className="font-mono">Authorization: Bearer</span> and receive JSON or XML.
        </p>
      </div>
      {params.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{params.error}</p> : null}
      {saved ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-pine">{saved}</p> : null}
      {!canEdit ? <p className="text-sm text-muted">You can view these endpoints. Edit access is required to change them.</p> : null}

      {canEdit ? (
        <section className="panel p-4">
          <details>
            <summary className="section-toggle flex cursor-pointer items-center gap-2 font-semibold">
              <span className="mark" aria-hidden="true" />
              New endpoint
            </summary>
            <div className="mt-4">
              <EndpointForm categories={categories} />
            </div>
          </details>
        </section>
      ) : null}

      {endpoints.length === 0 ? <p className="text-sm text-muted">No API endpoints yet.</p> : null}
      {endpoints.map((endpoint) => {
        const url = `${origin}/api/share/${endpoint.id}`;
        return (
          <section key={endpoint.id} className="panel p-4">
            <details>
              <summary className="section-toggle flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className="mark" aria-hidden="true" />
                  <span className={endpoint.isActive ? "text-lg font-semibold" : "text-lg font-semibold text-muted line-through"}>
                    {endpoint.name}
                  </span>
                </span>
                <span className="text-sm text-muted">
                  {endpoint.isActive ? "Enabled" : "Disabled"} · {endpoint.format}
                  {endpoint.secretOptional ? " · Secret optional" : ""}
                </span>
              </summary>
              <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label>
                <span className="label">URL</span>
                <input className="field font-mono" readOnly value={url} />
              </label>
              <span className="self-end"><CopyButton value={url} label="Copy URL" /></span>
              <label>
                <span className="label">
                  Secret
                  <HelpTip text="Sent on every request as Authorization: Bearer followed by this key, unless Secret optional is checked. It is not part of the URL. An address that sends the wrong secret more than 5 times is blocked for 1 hour." />
                </span>
                <input className="field font-mono" readOnly value={endpoint.secret} />
              </label>
              <span className="self-end"><CopyButton value={endpoint.secret} label="Copy secret" /></span>
            </div>
            {endpoint.secretOptional ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">
                The secret is optional on this endpoint. Anyone with the URL can read the shared data. Do not leave the secret optional for production use.
              </p>
            ) : null}
            <fieldset disabled={!canEdit} className="min-w-0 space-y-4 border-0 p-0">
              <EndpointForm
                categories={categories}
                endpoint={{
                  id: endpoint.id,
                  name: endpoint.name,
                  description: endpoint.description,
                  format: endpoint.format,
                  validFrom: dateKey(endpoint.validFrom),
                  validTo: dateKey(endpoint.validTo),
                  secretOptional: endpoint.secretOptional,
                  categories: endpoint.categories,
                  fieldIds: endpoint.fields.map((field) => field.fieldId),
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <form action={setApiEndpointActive}>
                  <input type="hidden" name="id" value={endpoint.id} />
                  <input type="hidden" name="active" value={endpoint.isActive ? "0" : "1"} />
                  <button className="btn-quiet" type="submit">{endpoint.isActive ? "Disable" : "Enable"}</button>
                </form>
                <form action={regenerateApiSecret} className="inline-flex items-center">
                  <input type="hidden" name="id" value={endpoint.id} />
                  <button className="btn-quiet" type="submit">Regenerate secret</button>
                  <HelpTip text="Replaces the secret immediately. The previous key stops working. Copy the new key and share it again." />
                </form>
              </div>
            </fieldset>
            <div>
              <h3 className="flex items-center text-sm font-semibold">
                Recent requests
                <HelpTip text="The last 50 calls to this URL, including requests that were denied. Each row shows when it happened, the source IP, the status, and the result. After the secret fails more than 5 times from one address, that address is blocked for 1 hour. Those blocked calls are listed here." />
              </h3>
              {endpoint.logs.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No requests yet.</p>
              ) : (
                <div className="mt-2 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left">
                      <tr>
                        <th className="px-2 py-1 font-semibold">Time</th>
                        <th className="px-2 py-1 font-semibold">Source IP</th>
                        <th className="px-2 py-1 font-semibold">Status</th>
                        <th className="px-2 py-1 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoint.logs.map((log) => (
                        <tr key={log.id} className="border-t border-line">
                          <td className="whitespace-nowrap px-2 py-1">{log.createdAt.toLocaleString()}</td>
                          <td className="px-2 py-1">{log.sourceIp || "Unknown"}</td>
                          <td className="px-2 py-1">{log.status}</td>
                          <td className="px-2 py-1">{log.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}

function EndpointForm({
  categories,
  endpoint,
}: {
  categories: {
    id: string;
    name: string;
    isActive: boolean;
    fields: { id: string; friendlyName: string; isActive: boolean }[];
  }[];
  endpoint?: {
    id: string;
    name: string;
    description: string;
    format: "JSON" | "XML";
    validFrom: string;
    validTo: string;
    secretOptional: boolean;
    categories: { categoryId: string; applyToFields: boolean }[];
    fieldIds: string[];
  };
}) {
  return (
    <form action={saveApiEndpoint} className="space-y-4">
      {endpoint ? <input type="hidden" name="id" value={endpoint.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <span className="label">
            Friendly name
            <HelpTip text="A reference name for this page. It is not part of the URL shared with a third party." />
          </span>
          <input className="field" name="name" required defaultValue={endpoint?.name ?? ""} />
        </label>
        <label>
          <span className="label">Format</span>
          <select className="field" name="format" defaultValue={endpoint?.format ?? "JSON"}>
            <option value="JSON">JSON</option>
            <option value="XML">XML</option>
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="label">Notes</span>
          <textarea className="field min-h-20" name="description" defaultValue={endpoint?.description ?? ""} />
        </label>
        <div className="md:col-span-2 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="secretOptional" value="on" defaultChecked={endpoint?.secretOptional ?? false} />
            Secret optional
            <HelpTip text="When this is checked, a request can omit the secret. A wrong secret is still rejected. An address that fails the secret more than 5 times is blocked for 1 hour." />
          </label>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">
            Do not leave the secret optional for production use. Anyone with the URL can read the shared data.
          </p>
        </div>
        <label>
          <span className="label">
            From
            <HelpTip text="Optional. The endpoint accepts requests on this date and after. Leave it blank to leave the start open." />
          </span>
          <input className="field" type="date" name="validFrom" defaultValue={endpoint?.validFrom ?? ""} />
        </label>
        <label>
          <span className="label">
            To
            <HelpTip text="Optional. The endpoint accepts requests on this date and before. Leave it blank to leave the end open. Both dates blank means it works whenever it is enabled." />
          </span>
          <input className="field" type="date" name="validTo" defaultValue={endpoint?.validTo ?? ""} />
        </label>
      </div>
      <div>
        <h3 className="flex items-center text-sm font-semibold">
          Shared attributes
          <HelpTip text="Choose a whole dimension, specific attributes, or a mix. A whole dimension includes attributes added to it later. Specific attributes stay as you checked them. The response includes each attribute's definition and the active dimension values." />
        </h3>
        <div className="mt-3 space-y-3">
          {categories.map((category) => {
            const scope = endpoint?.categories.find((row) => row.categoryId === category.id);
            const specific = scope?.applyToFields ?? false;
            return (
              <fieldset key={category.id} className="rounded-md border border-line p-3">
                <legend className="px-1 text-sm font-semibold">
                  {category.name}
                  {category.isActive ? "" : " (hidden)"}
                </legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`cat:${category.id}:scope`} value="none" defaultChecked={!scope} />
                    None
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`cat:${category.id}:scope`} value="category" defaultChecked={Boolean(scope && !specific)} />
                    Entire dimension
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`cat:${category.id}:scope`} value="fields" defaultChecked={specific} />
                    Specific attributes
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  {category.fields.map((field) => (
                    <label key={field.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`field:${field.id}`}
                        value="on"
                        defaultChecked={endpoint?.fieldIds.includes(field.id) ?? false}
                      />
                      <span className={field.isActive ? "" : "text-muted"}>
                        {field.friendlyName}
                        {field.isActive ? "" : " (hidden)"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>
      <button className="btn" type="submit">{endpoint ? "Save endpoint" : "Create endpoint"}</button>
    </form>
  );
}
