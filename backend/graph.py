from typing import Annotated, Literal
from langgraph.graph import StateGraph, START, END
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from typing_extensions import TypedDict, List
from langgraph.graph.message import add_messages
from openai import OpenAI
from langchain.tools import tool
from supabase import create_client
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage, AIMessage, BaseMessage
from langfuse import Langfuse
from langfuse.langchain import CallbackHandler
from dotenv import load_dotenv
import os


load_dotenv()
openai_client = OpenAI(os.getenv('OPENAI_API_KEY'))
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))
langfuse = Langfuse(
    public_key=os.getenv('LANGFUSE_PUBLIC_KEY'),
    secret_key=os.getenv('LANGFUSE_SECRET_KEY'),
    host="https://cloud.langfuse.com"
)

langfuse_handler = CallbackHandler()


class State(TypedDict):
    messages: Annotated[list, add_messages]
graph_builder = StateGraph(State)

llm = init_chat_model('gpt-5.1', streaming=True,
                     api_key=os.getenv('OPENAI_API_KEY'))

@tool("fetch_yc_chunks")
def fetch_yc_chunks_tool(query: str, match_count: int = 10) -> str:
    """
    Fetches YC transcript chunks from Supabase via pgvector.
    """
    emb = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=query,
    )
    query_vec = emb.data[0].embedding

    res = supabase.rpc(
        "match_chunks",
        {
            "query_embedding": query_vec,
            "match_count": match_count,
        }
    ).execute()

    rows = res.data or []
    doc_ids = list(set(r['document_id'] for r in rows))
    docs = supabase.table("documents").select("*").in_("id", doc_ids).execute()

    if not rows:
        return "No relevant chunks found."

    context = "\n\n".join(
        f"Chunk {r['chunk_index']} (score {r['similarity']:.2f}):\n{r['text']}"
        for r in rows
    )

    return {
    "context": context,
    "videos": [doc['title'] for doc in docs.data],
    "urls": [doc['source'] for doc in docs.data]
}

tools = [fetch_yc_chunks_tool]
tools_by_name = {tool.name: tool for tool in tools}
model = llm.bind_tools(tools)

def master(state: State) -> State:
    system_msg ="""
    You are a YC-informed startup advisor. You have access to YC transcript retrieval. 
Your goal is to give the best possible answer with the least unnecessary computation.

Retrieval policy:
- Retrieve when YC’s perspective, patterns, partner advice, or startup school content would meaningfully improve the answer.
- This includes: idea evaluation, founder dynamics, equity splits, fundraising, growth, metrics, retention, PMF, tarpit ideas, launch velocity, sales, pricing, pivots, cofounder problems.
- Retrieve when the question implicitly depends on YC expertise even if the user does NOT mention YC.

Skip retrieval when:
- The user is greeting, clarifying, asking a meta question, or saying something that YC content will not materially improve.
- The question is generic, obvious, or personal where YC transcripts add no incremental insight.

Key principle:
Ask yourself: “Would YC’s historical advice or patterns change or significantly strengthen the answer?”  
If yes → retrieve.  
If not → answer directly.

Distillation rule:
When retrieving, distill the user’s message into a SHORT semantic search query (3 to 8 tokens). 
Do NOT include their pitch, backstory, or extra text in the embedding. 
Only include the conceptual target (e.g., “equity splits founders”, “YC tarpit ideas”, “fundraising early traction”, “default alive math”, “retention benchmarks”).

Behavior:
- You may retrieve at most twice per user message.
- If retrieval returns irrelevant chunks, refine the distilled query and try once more.
- You must not retrieve blindly or every time — retrieval is only used when it materially improves the answer.
- You must not answer purely from your own reasoning when YC has strong prior opinions on the topic.

Your job is to orchestrate:
1) decide if YC context is needed
2) decide if retrieval will add signal
3) call retrieval only when it provides value
4) answer using your own reasoning + retrieved YC context when helpful
5) provide an answer ##STRICTLY under 500 words and anything you wanted to include and couldnt because of the limit
 must be asked as a suggestion "should I do xyz next" etc.
            """
    ai = model.invoke([system_msg] + state["messages"])
    return {"messages": [ai]}

def check_for_tool(state: State) -> str:
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None):
        return "tool"
    return "next"

def tool_node(state: State) -> State:
    """ Performs tool calls """
    result = []
    for tool_call in state["messages"][-1].tool_calls:
        tool = tools_by_name[tool_call['name']]
        observation = tool.invoke(tool_call['args'])
        result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
    return {"messages": result}

graph_builder = StateGraph(State)

graph_builder.add_node("master", master)
graph_builder.add_node("tool", tool_node)


graph_builder.add_edge(START, "master")
graph_builder.add_conditional_edges(
    "master",
    check_for_tool,
    {
        "tool": "tool",   
        "next": END,    
    },
)

graph_builder.add_edge("tool", "master")
graph = graph_builder.compile()
