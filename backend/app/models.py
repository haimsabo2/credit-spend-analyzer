from datetime import date, datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    pass


class UploadBase(SQLModel):
    month: str = Field(index=True, description="Statement month in YYYY-MM format")
    original_filename: str
    content_type: Optional[str] = None
    size_bytes: int
    file_hash: str = Field(index=True, description="SHA-256 hash of the file contents")
    num_transactions: int = 0


class Upload(UploadBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        index=True,
        description="Time the upload was created",
    )

    transactions: List["Transaction"] = Relationship(back_populates="upload")


class CategoryBase(SQLModel):
    name: str = Field(index=True, description="Category name, e.g. Groceries, Travel")
    description: Optional[str] = None
    is_system: bool = Field(
        default=False,
        description="True for built-in categories; False for user-defined ones",
    )


class Category(CategoryBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    transactions: List["Transaction"] = Relationship(back_populates="category")
    rules: List["ClassificationRule"] = Relationship(back_populates="category")
    budgets: List["Budget"] = Relationship(back_populates="category")


class TransactionBase(SQLModel):
    card_label: Optional[str] = Field(
        default=None,
        index=True,
        description="Card or cardholder label derived from the report",
    )
    section: Optional[str] = Field(
        default=None,
        index=True,
        description="Section or group label from the report",
    )
    posted_at: Optional[date] = Field(default=None, index=True)
    description: str
    amount: float
    currency: Optional[str] = Field(default="USD")
    row_signature: str = Field(
        index=True,
        unique=True,
        description="Stable deduplication key across all uploads",
    )
    needs_review: bool = Field(
        default=False,
        index=True,
        description="True if this transaction needs manual review",
    )
    confidence: float = Field(
        default=0.0,
        description="Categorization confidence: 1.0=manual, 0.9=rule-matched, 0.3=unmatched",
    )
    raw_row_data: Optional[str] = Field(
        default=None,
        description="JSON-serialized raw row data from the source report",
    )
    reason_he: Optional[str] = Field(
        default=None,
        description="Hebrew explanation from LLM categorizer",
    )
    meta_json: Optional[str] = Field(
        default=None,
        description="JSON blob for extra metadata (e.g. suggest_new_category)",
    )


class Transaction(TransactionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    upload_id: int = Field(foreign_key="upload.id", index=True)
    category_id: Optional[int] = Field(
        default=None,
        foreign_key="category.id",
        index=True,
    )
    rule_id_applied: Optional[int] = Field(
        default=None,
        foreign_key="classificationrule.id",
        index=True,
    )

    upload: Optional[Upload] = Relationship(back_populates="transactions")
    category: Optional[Category] = Relationship(back_populates="transactions")


class BudgetBase(SQLModel):
    month: str = Field(index=True, description="Budget month YYYY-MM")
    budget_amount: float


class Budget(BudgetBase, table=True):
    __table_args__ = (UniqueConstraint("category_id", "month"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    category_id: int = Field(foreign_key="category.id", index=True)

    category: Category = Relationship(back_populates="budgets")


class ClassificationRuleBase(SQLModel):
    pattern: str = Field(
        description="Pattern to match against transaction description",
    )
    match_type: str = Field(
        default="contains",
        description="How to match: contains, regex, or merchant_key (exact case-insensitive)",
    )
    priority: int = Field(
        default=100,
        description="Lower values are applied first when multiple rules match",
    )
    active: bool = Field(default=True)
    card_label_filter: Optional[str] = Field(
        default=None,
        description="Optional card label to scope this rule to",
    )


class ClassificationRule(ClassificationRuleBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    category_id: int = Field(foreign_key="category.id", index=True)

    category: Category = Relationship(back_populates="rules")

