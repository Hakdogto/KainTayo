from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("restaurants", "0004_restaurant_performance_indexes"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="FavoriteExternalPlace",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("session_key", models.CharField(blank=True, default="", max_length=64)),
                ("place_id", models.CharField(max_length=128)),
                ("name", models.CharField(max_length=255)),
                ("cuisine", models.CharField(blank=True, max_length=120)),
                ("address", models.CharField(blank=True, max_length=255)),
                ("detail_url", models.CharField(blank=True, max_length=255)),
                ("rating", models.DecimalField(blank=True, decimal_places=1, max_digits=2, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=models.deletion.CASCADE,
                        related_name="favorite_external_places",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="favoriteexternalplace",
            constraint=models.UniqueConstraint(fields=("user", "place_id"), name="unique_external_favorite_per_user"),
        ),
        migrations.AddConstraint(
            model_name="favoriteexternalplace",
            constraint=models.UniqueConstraint(
                condition=models.Q(("session_key", ""), _negated=True),
                fields=("session_key", "place_id"),
                name="unique_external_favorite_per_session",
            ),
        ),
    ]
