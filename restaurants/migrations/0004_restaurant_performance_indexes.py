from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("restaurants", "0003_restaurant_embedding"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="restaurant",
            index=models.Index(fields=["cuisine"], name="restaurant_cuisine_idx"),
        ),
        migrations.AddIndex(
            model_name="restaurant",
            index=models.Index(fields=["is_open_now"], name="restaurant_open_now_idx"),
        ),
        migrations.AddIndex(
            model_name="restaurant",
            index=models.Index(fields=["-rating"], name="restaurant_rating_desc_idx"),
        ),
        migrations.AddIndex(
            model_name="restaurant",
            index=models.Index(fields=["average_cost_for_two"], name="restaurant_budget_idx"),
        ),
    ]
