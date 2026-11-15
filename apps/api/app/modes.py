MODES = [
    {"id": "dsa", "name": "Coding & algorithms", "short": "Coding", "category": "Think it through. Build it right.",
     "description": "Explain your approach, reason about complexity, and work through a coding problem.", "icon": "code", "number": "01",
     "tools": "Python editor and isolated tests arrive in Phase 2.",
     "rubric": ["Clarification", "Correctness", "Complexity", "Edge cases", "Code quality", "Communication"],
     "opening": "Before we start solving, what are the inputs, expected output, and constraints for this problem?"},
    {"id": "project", "name": "Project deep dive", "short": "Projects", "category": "Know the decisions behind your code.",
     "description": "Discuss architecture, implementation, ownership, and the trade-offs in your projects.", "icon": "layers", "number": "02",
     "tools": "Repository indexing and source citations arrive in Phase 4.",
     "rubric": ["Architecture", "Implementation depth", "Ownership", "Evidence", "Trade-offs"],
     "opening": "Choose a project you know well. What problem does it solve, and which parts did you personally build?"},
    {"id": "design", "name": "System design", "short": "System design", "category": "Turn requirements into decisions.",
     "description": "Clarify scope, estimate scale, and defend an architecture under real constraints.", "icon": "workflow", "number": "03",
     "tools": "The architecture canvas arrives in Phase 5.",
     "rubric": ["Requirements", "Scale", "Architecture", "Reliability", "Trade-offs"],
     "opening": "What should this system do for its users, and which requirements would you clarify before designing it?"},
    {"id": "backend", "name": "Backend engineering", "short": "Backend", "category": "Go deeper than the happy path.",
     "description": "Explore APIs, databases, concurrency, debugging, and the realities of production.", "icon": "server", "number": "04",
     "tools": "Grounding in your own engineering notes arrives in Phase 4.",
     "rubric": ["Accuracy", "Implementation", "Production awareness", "Debugging", "Communication"],
     "opening": "An API occasionally creates duplicate orders after a client retries. How would you investigate and prevent that?"},
    {"id": "ai", "name": "AI & LLM engineering", "short": "AI engineering", "category": "Connect the concepts to the system.",
     "description": "Reason about retrieval, inference, evaluation, agents, and shipping reliable AI.", "icon": "sparkles", "number": "05",
     "tools": "Topic collections and retrieved evidence arrive in Phase 4.",
     "rubric": ["Conceptual accuracy", "Implementation", "Evaluation", "Failure analysis", "Trade-offs"],
     "opening": "A retrieval-augmented assistant gives a plausible answer that its sources do not support. How would you isolate the failure?"},
    {"id": "behavioral", "name": "Resume & behavioral", "short": "Behavioral", "category": "Tell the story only you can tell.",
     "description": "Practise specific, honest stories about contribution, challenges, and impact.", "icon": "message", "number": "06",
     "tools": "Resume, job description, and story-bank ingestion arrive in Phase 5.",
     "rubric": ["Specificity", "Ownership", "Structure", "Impact", "Reflection"],
     "opening": "Tell me about a difficult technical decision you helped make. What was your responsibility, and what happened?"},
]
MODE_BY_ID = {mode["id"]: mode for mode in MODES}
PHASES = ["setup", "context_loading", "introduction", "clarification", "answer", "follow_up", "coding", "evaluation", "report"]
TRANSITIONS = {
    "setup": {"context_loading"}, "context_loading": {"introduction"},
    "introduction": {"clarification"}, "clarification": {"answer", "evaluation"},
    "answer": {"follow_up", "coding", "evaluation"},
    "follow_up": {"answer", "coding", "evaluation"}, "coding": {"follow_up", "evaluation"},
    "evaluation": {"report"}, "report": set(),
}

def validate_transition(current: str, target: str) -> None:
    if target not in TRANSITIONS.get(current, set()):
        raise ValueError(f"Cannot move from {current} to {target}.")
