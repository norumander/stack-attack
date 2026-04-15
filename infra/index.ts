import * as pulumi from "@pulumi/pulumi";

// ─── Config ───────────────────────────────────────────
const config = new pulumi.Config("stack-attack");
const environment = config.get("environment") || "production";
const region = config.get("region") || "us-west-2";

// ─── Railway Project (via Railway API) ────────────────
// Railway doesn't have a native Pulumi provider yet,
// so we use a Dynamic Provider that calls the Railway API.

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

interface RailwayProjectInputs {
  name: string;
  description: string;
}

interface RailwayProjectOutputs extends RailwayProjectInputs {
  projectId: string;
}

const railwayProjectProvider: pulumi.dynamic.ResourceProvider = {
  async create(inputs: RailwayProjectInputs): Promise<pulumi.dynamic.CreateResult> {
    const token = process.env.RAILWAY_TOKEN;
    if (!token) throw new Error("RAILWAY_TOKEN env var required");

    const res = await fetch(RAILWAY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `mutation { projectCreate(input: { name: "${inputs.name}", description: "${inputs.description}" }) { id name } }`,
      }),
    });

    const data = (await res.json()) as { data?: { projectCreate?: { id: string } } };
    const projectId = data?.data?.projectCreate?.id;
    if (!projectId) throw new Error("Failed to create Railway project");

    return { id: projectId, outs: { ...inputs, projectId } };
  },

  async delete(id: string) {
    const token = process.env.RAILWAY_TOKEN;
    if (!token) return;

    await fetch(RAILWAY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `mutation { projectDelete(id: "${id}") }`,
      }),
    });
  },
};

// ─── Resources ────────────────────────────────────────

const project = new pulumi.dynamic.Resource(
  "railway-project",
  railwayProjectProvider,
  {
    name: `stack-attack-${environment}`,
    description: "Stack Attack — Learn System Architecture by Defending It",
  }
);

// ─── Exports ──────────────────────────────────────────
export const projectId = project.id;
export const projectName = `stack-attack-${environment}`;
export const env = environment;
export const deployRegion = region;
