from fastapi import FastAPI, Request
from pydantic import BaseModel
from typing import List, Literal, Optional, Dict, Any
from graph import graph
from langchain_core.messages import HumanMessage, AIMessage
from fastapi.responses import StreamingResponse
import json

app = FastAPI()
class MessagePart(BaseModel):
    type: str
    text: Optional[str] = None 
    state: Optional[str] = None
class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    parts: list[MessagePart]
    id: str

class ChatRequest(BaseModel):
    messages: list[Message]


async def generate_stream(messages: ChatRequest):
    lc_messages = []
    for msg in messages.messages:
        content = " ".join(part.text for part in msg.parts if part.type == "text" and part.text)
        if not content:
            continue
        if msg.role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif msg.role == "assistant":
            lc_messages.append(AIMessage(content=content))
    
    source_pairs = []
    seen_sources = set()
    
    async for event in graph.astream_events({"messages": lc_messages}, version="v2"):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            content = event["data"]["chunk"].content
            if content:
                yield content
        
        elif kind == "on_tool_end":
            try:
                output = event["data"].get("output")
                if isinstance(output, dict):
                    videos = output.get("videos") or []
                    urls = output.get("urls") or []
                    for video, url in zip(videos, urls):
                        key = (video, url)
                        if key in seen_sources:
                            continue
                        seen_sources.add(key)
                        source_pairs.append((video, url))
            except:
                pass
    
    if source_pairs:
        videos, urls = zip(*source_pairs)
        sources_payload = {"videos": list(videos), "urls": list(urls)}
        yield f"2:{json.dumps({'type': 'data-sources', 'data': sources_payload})}\n"

@app.post("/stream")
async def stream(messages: ChatRequest):
    return StreamingResponse(
        generate_stream(messages),
        media_type="text/plain",
    )
