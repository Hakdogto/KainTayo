from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("restaurants", "0005_favoriteexternalplace"),
    ]

    operations = [
        migrations.AddField(
            model_name="favoriterestaurant",
            name="note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="favoriterestaurant",
            name="tags",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="favoriterestaurant",
            name="status",
            field=models.CharField(default="want_to_try", max_length=24),
        ),
        migrations.AddField(
            model_name="favoriteexternalplace",
            name="note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="favoriteexternalplace",
            name="tags",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="favoriteexternalplace",
            name="status",
            field=models.CharField(default="want_to_try", max_length=24),
        ),
        migrations.AddIndex(
            model_name="favoriterestaurant",
            index=models.Index(
                fields=["session_key", "-created_at"],
                name="fav_local_session_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="favoriterestaurant",
            index=models.Index(fields=["user", "-created_at"], name="fav_local_user_created_idx"),
        ),
        migrations.AddIndex(
            model_name="favoriteexternalplace",
            index=models.Index(
                fields=["session_key", "-created_at"],
                name="fav_ext_session_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="favoriteexternalplace",
            index=models.Index(fields=["user", "-created_at"], name="fav_ext_user_created_idx"),
        ),
    ]
