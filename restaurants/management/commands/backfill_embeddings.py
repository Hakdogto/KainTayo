from django.core.management.base import BaseCommand

from restaurants.models import Restaurant
from restaurants.services.vector_search import update_restaurant_embedding


class Command(BaseCommand):
    help = "Generate and store embeddings for restaurants."

    def add_arguments(self, parser):
        parser.add_argument(
            "--only-missing",
            action="store_true",
            help="Embed only restaurants with null embeddings.",
        )

    def handle(self, *args, **options):
        queryset = Restaurant.objects.all()
        if options["only_missing"]:
            queryset = queryset.filter(embedding__isnull=True)

        total = queryset.count()
        updated = 0
        failed = 0

        for restaurant in queryset.iterator():
            ok = update_restaurant_embedding(restaurant)
            if ok:
                updated += 1
            else:
                failed += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Embedding backfill done. total={total}, updated={updated}, failed={failed}"
            )
        )
