const BASE = "https://api.retellai.com";

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// Point the agent's webhook at our public ngrok URL so call events reach us.
export async function setAgentWebhook(apiKey, agentId, webhookUrl) {
  const res = await fetch(`${BASE}/update-agent/${agentId}`, {
    method: "PATCH",
    headers: headers(apiKey),
    body: JSON.stringify({ webhook_url: webhookUrl }),
  });
  if (!res.ok) {
    throw new Error(`Retell update-agent failed: ${res.status} ${await res.text()}`);
  }
}

// Place an outbound call. The spoken prompt is injected into the agent prompt
// as the dynamic variable {{your_question}}.
export async function placeCall(apiKey, { fromNumber, toNumber, agentId, prompt }) {
  const res = await fetch(`${BASE}/v2/create-phone-call`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      from_number: fromNumber,
      to_number: toNumber,
      override_agent_id: agentId,
      retell_llm_dynamic_variables: { your_question: prompt },
    }),
  });
  if (!res.ok) {
    throw new Error(`Retell create-phone-call failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.call_id;
}
