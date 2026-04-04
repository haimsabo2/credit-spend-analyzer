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
    skipped_duplicates_count: int = Field(
        default=0,
        description="Rows in file that matched existing row_signature (no new transaction)",
    )
    enriched_row_count: Optional[int] = Field(
        default=None,
        description="For enrich_only uploads: rows updated with source trace",
    )
    stored_path: Optional[str] = Field(
        default=None,
        description="Filename or path under upload storage dir for the original XLS",
    )


class Upload(UploadBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        index=True,
        description="Time the upload was created",
    )

    transactions: List["Transaction"] = Relationship(
        back_populates="upload",
        sa_relationship_kwargs={"foreign_keys": "[Transaction.upload_id]"},
    )


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
    subcategories: List["Subcategory"] = Relationship(back_populates="category")


class Subcategory(SQLModel, table=True):
    """Optional finer label under a category (e.g. fruits under groceries)."""

    __table_args__ = (UniqueConstraint("category_id", "name"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    category_id: int = Field(foreign_key="category.id", index=True)
    name: str = Field(index=True)

    category: Optional["Category"] = Relationship(back_populates="subcategories")


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
    posted_at: Optional[date] = Field(
        default=None,
        index=True,
        description="Purchase/transaction date from the report when available; not the card billing date",
    )
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
    spend_pattern: str = Field(
        default="unknown",
        index=True,
        description="recurring (~monthly), one_time (spike / abroad noise), or unknown",
    )
    spend_pattern_user_set: bool = Field(
        default=False,
        description="If true, auto-categorization must not change spend_pattern",
    )
    source_row_1based: Optional[int] = Field(
        default=None,
        index=True,
        description="1-based row index in the source XLS (first sheet) for this transaction line",
    )
    source_sheet_index: Optional[int] = Field(
        default=None,
        description="0-based worksheet index (parser currently uses first sheet only)",
    )
    source_trace_upload_id: Optional[int] = Field(
        default=None,
        foreign_key="upload.id",
        index=True,
        description="Upload row whose stored XLS is used for source download / row location",
    )


class Transaction(TransactionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    upload_id: int = Field(foreign_key="upload.id", index=True)
    category_id: Optional[int] = Field(
        default=None,
        foreign_key="category.id",
        index=True,
    )
    subcategory_id: Optional[int] = Field(
        default=None,
        foreign_key="subcategory.id",
        index=True,
    )
    rule_id_applied: Optional[int] = Field(
        default=None,
        foreign_key="classificationrule.id",
        index=True,
    )

    upload: Optional[Upload] = Relationship(
        back_populates="transactions",
        sa_relationship_kwargs={"foreign_keys": "[Transaction.upload_id]"},
    )
    category: Optional[Category] = Relationship(back_populates="transactions")
    subcategory: Optional["Subcategory"] = Relationship()


class MerchantSpendGroup(SQLModel, table=True):
    """User-defined label merging several statement lines (normalized pattern_key)."""

    __tablename__ = "merchant_spend_group"

    id: Optional[int] = Field(default=None, primary_key=True)
    display_name: str = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    members: List["MerchantSpendGroupMember"] = Relationship(
        back_populates="group",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class MerchantSpendGroupMember(SQLModel, table=True):
    __tablename__ = "merchant_spend_group_member"
    __table_args__ = (UniqueConstraint("pattern_key"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="merchant_spend_group.id", index=True)
    pattern_key: str = Field(
        index=True,
        unique=True,
        description="lower(trim(description)); each key at most one group",
    )

    group: Optional[MerchantSpendGroup] = Relationship(back_populates="members")


class MerchantKeyUserApproval(SQLModel, table=True):
    """User marked this normalized description key as reviewed (category OK or fixed)."""

    __tablename__ = "merchant_key_user_approval"

    id: Optional[int] = Field(default=None, primary_key=True)
    pattern_key: str = Field(
        index=True,
        unique=True,
        description="lower(trim(description)) matching merchant_key rules",
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    subcategory_id: Optional[int] = Field(
        default=None,
        foreign_key="subcategory.id",
        index=True,
        description="Preferred subcategory for all transactions with this pattern when category matches",
    )


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

