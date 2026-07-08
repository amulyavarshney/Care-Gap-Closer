from dotenv import load_dotenv

load_dotenv()  # populate GOOGLE_API_KEY etc. before tools import google.genai

from po_fastmcp import POFastMCP
from tools import register_tools

# SMART scopes the tools need. Patient + Condition + Observation + Procedure +
# Immunization cover the rule engine; MedicationRequest is here for future
# statin-therapy gap.
fhir_scopes = [
    {"name": "patient/Patient.rs", "required": True},
    {"name": "patient/Condition.rs", "required": True},
    {"name": "patient/Observation.rs", "required": True},
    {"name": "patient/Procedure.rs", "required": True},
    {"name": "patient/Immunization.rs", "required": True},
    {"name": "patient/MedicationRequest.rs"},
]

mcp = POFastMCP(
    name="Care Gap Closer MCP",
    instructions=(
        "Tools for identifying USPSTF-aligned preventive care gaps from a "
        "patient's FHIR record and drafting patient-facing outreach for them."
    ),
    fhir_scopes=fhir_scopes,
)

register_tools(mcp)


def main() -> None:
    import os

    port = int(os.getenv("MCP_PORT", "9000"))
    host = os.getenv("MCP_HOST", "127.0.0.1")
    try:
        print(f"Starting Care Gap Closer MCP at http://{host}:{port}/mcp")
        print("Press Ctrl+C to stop.")
        # stateless_http + json_response keeps the server interoperable with
        # plain HTTP/JSON clients (e.g. the PromptOpinion MCP test probe).
        # Without these, MCP's Streamable HTTP transport requires every caller
        # to include `Accept: text/event-stream` and to keep an SSE stream open
        # via GET /mcp, which most generic HTTP clients do not do.
        mcp.run(
            transport="http",
            host=host,
            port=port,
            stateless_http=False,
            json_response=True,
        )
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
