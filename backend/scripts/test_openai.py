from openai import OpenAI

client = OpenAI()

resp = client.responses.create(
    model="gpt-4o-mini",
    input="Say hello from my credit analyzer project"
)

print(resp.output_text)