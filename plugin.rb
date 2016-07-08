# name: discourse-osf-projects
# about: Introduces the concept of projects or sub-sites that can be either public or private
# version: 0.0.1
# authors: Acshi Haggenmiller
enabled_site_setting :osf_projects_enabled

register_asset 'stylesheets/osf-projects.scss'

register_asset 'javascripts/discourse/templates/projects/index.hbs', :server_side
register_asset 'javascripts/discourse/templates/projects/show.hbs', :server_side

after_initialize do
    PARENT_GUIDS_FIELD_NAME = "parent_guids"
    PROJECT_GUID_FIELD_NAME = "project_guid" # DB use only: equivalent to parent_guids[0]
    TOPIC_GUID_FIELD_NAME = "topic_guid"
    PARENT_NAMES_FIELD_NAME = "parent_names"

    module ::OsfProjects
        class Engine < ::Rails::Engine
            engine_name "osf_projects"
            isolate_namespace OsfProjects
        end

        def self.clean_guid(guid)
            guid.downcase.gsub(/[^a-z0-9]/, '')
        end

        def self.names_for_guids(guids)
            topics = Topic.unscoped
                            .joins("LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)")
                            .references('tc')
                            .where('tc.name = ? AND tc.value IN (?)', TOPIC_GUID_FIELD_NAME, guids)
            guids.map do |guid|
                topic = topics.select { |t| t.topic_guid == guid }[0]
                topic ? topic.title : ''
            end
        end

        def self.topic_for_guid(guid)
            topics = Topic.unscoped
                            .joins("LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)")
                            .references('tc')
                            .where('tc.name = ? AND tc.value = ?', TOPIC_GUID_FIELD_NAME, guid)
            #[topics[0].parent_guids].flatten if topics[0]
            topics[0]
        end

        def self.can_create_project_topic(project_guid, user)
            return true if user.staff?
            return false if user == nil
            sql = <<-SQL
                SELECT 1
                FROM groups
                INNER JOIN group_users AS gu ON groups.id = gu.group_id
                WHERE groups.name = :project_guid AND gu.user_id = :user_id
            SQL
            result = User.exec_sql(sql, project_guid: project_guid, user_id: user.id).to_a
            result.length > 0
        end

        def self.allowed_project_topics(topics, user)
            return topics if user && user.staff?
            # a visible group is a public one
            allowed_project_guids = Group.select(:name)
                                         .joins("INNER JOIN group_users AS gu ON groups.id = gu.group_id")
                                         .where((user ? "gu.user_id = :user_id OR " : "") + "groups.visible = 't'",
                                                 user_id: user ? user.id : nil)
            topics.joins("LEFT JOIN topic_custom_fields AS tc ON topics.id = tc.topic_id")
                  .where("tc.name = ? AND tc.value IN (#{allowed_project_guids.to_sql})", PROJECT_GUID_FIELD_NAME)
        end
    end

    # Register these custom fields so that they will allowed as parameters
    # We don't pass a block when we don't want to allow these guids
    # to be changed in the future.
    PostRevisor.track_topic_field(:parent_guids) do |tc, parent_guids|
        parent_guids = parent_guids.map { |guid| OsfProjects::clean_guid(guid) }
        tc.topic.custom_fields.update(PARENT_GUIDS_FIELD_NAME => parent_guids)
        tc.topic.custom_fields.update(PROJECT_GUID_FIELD_NAME => parent_guids[0])
    end
    PostRevisor.track_topic_field(:topic_guid)

    on(:before_create_topic) do |topic, topic_creator|
        topic_creator.prepare_project_topic(topic)
    end

    # Hook onto topic creation to save our custom fields
    on(:topic_created) do |topic, params, user|
        next unless params[:parent_guids]
        parent_guids = params[:parent_guids].map { |guid| OsfProjects::clean_guid(guid) }

        unless user.staff?
            next unless OsfProjects::can_create_project_topic(parent_guids[0], user)
        end

        if params[:topic_guid]
            topic_guid = OsfProjects::clean_guid(params[:topic_guid])
            topic.custom_fields.update(TOPIC_GUID_FIELD_NAME => topic_guid)
        end

        topic.custom_fields.update(PARENT_GUIDS_FIELD_NAME => parent_guids)
        topic.custom_fields.update(PROJECT_GUID_FIELD_NAME => parent_guids[0])
        topic.save
    end

    # Add methods for directly extracting these fields
    # and making them accessible to the TopicViewSerializer
    Topic.class_eval do
        def parent_guids
            [custom_fields[PARENT_GUIDS_FIELD_NAME]].flatten
        end
        def topic_guid
            custom_fields[TOPIC_GUID_FIELD_NAME]
        end
        # cache these for db performance (does it help?)
        def parent_names
            @parent_names ||= OsfProjects::names_for_guids(parent_guids)
        end
        def project_is_public
            return @project_is_public if @project_is_public != nil
            projectGroup = Group.select(:visible).where(name: parent_guids[0]).first
            @project_is_public = projectGroup ? projectGroup.visible : false
        end

        # Override the default results for permissions control
        old_secured = self.method(:secured)
        scope :secured, lambda { |guardian=nil|
            result = old_secured.call
            OsfProjects::allowed_project_topics(result, guardian ? guardian.user : nil)
        }
    end

    TopicCreator.class_eval do
        def prepare_project_topic(topic)
            return unless @opts[:archetype] == Archetype.default
            # Associate it with the project group
            add_groups(topic, [@opts[:parent_guids][0]])
        end
    end

    # override slug generation
    add_to_class :topic, :slug do
        slug = topic_guid
        unless read_attribute(:slug)
          if new_record?
            write_attribute(:slug, slug)
          else
            update_column(:slug, slug)
          end
        end
        slug
    end

    # Register these Topic attributes to appear on the Topic page
    TopicViewSerializer.attributes_from_topic(:parent_guids)
    TopicViewSerializer.attributes_from_topic(:topic_guid)
    TopicViewSerializer.attributes_from_topic(:parent_names)
    TopicViewSerializer.attributes_from_topic(:project_is_public)

    # Register these to appear on the TopicList page/the SuggestedTopics for each item
    add_to_serializer(:listable_topic, :parent_guids) { object.parent_guids }
    add_to_serializer(:listable_topic, :topic_guid) { object.topic_guid }
    add_to_serializer(:listable_topic, :parent_names) { object.parent_names }
    add_to_serializer(:listable_topic, :project_is_public) { object.project_is_public }

    # Mark as preloaded so they are included in the SQL queries
    if TopicList.respond_to? :preloaded_custom_fields
        TopicList.preloaded_custom_fields << PARENT_GUIDS_FIELD_NAME
        TopicList.preloaded_custom_fields << TOPIC_GUID_FIELD_NAME
        #TopicList.preloaded_custom_fields << PARENT_NAMES_FIELD_NAME
    end

    require_dependency 'application_controller'
    require_dependency 'topic_list_responder'
    require_dependency 'topic_query'

    # Add custom topic list attributes and add register them to be output by the serializer
    TopicList.class_eval do
        attr_accessor :parent_guids
        attr_accessor :parent_names
        attr_accessor :project_is_public
    end
    TopicListSerializer.class_eval do
        attributes :parent_guids
        attributes :parent_names
        attributes :project_is_public
        def can_create_topic
            scope.can_create?(Topic) &&
                object.parent_guids &&
                OsfProjects::can_create_project_topic(object.parent_guids[0], scope.user)
        end
    end

    TopicQuery.class_eval do
        def latest_project_results(project_guid)
            result = default_project_results(project_guid)
            remove_muted_topics(result, @user)
        end

        def unread_project_results(project_guid)
            result = default_project_results(project_guid)
            result = TopicQuery.unread_filter(result)
            suggested_ordering(result, {})
        end

        def new_project_results(project_guid)
            result = default_project_results(project_guid)
            result = TopicQuery.new_filter(result, @user.user_option.treat_as_new_topic_start_date)
            result = remove_muted_topics(result, @user)
            suggested_ordering(result, {})
        end

        def read_project_results(project_guid)
            default_project_results(project_guid).order('COALESCE(tu.last_visited_at, topics.bumped_at) DESC')
        end

        def posted_project_results(project_guid)
            default_project_results(project_guid).where('tu.posted')
        end

        def bookmarks_project_results(project_guid)
            default_project_results(project_guid).where('tu.bookmarked')
        end

        def default_project_results(project_guid)
            default_results.joins("LEFT JOIN topic_custom_fields AS tc2 ON (topics.id = tc2.topic_id)")
                           .where("tc2.name = ? AND tc2.value = ?", PARENT_GUIDS_FIELD_NAME, project_guid)
        end

        # Override the default results for permissions control
        old_default_results = self.instance_method(:default_results)
        define_method(:default_results) do |options={}|
            result = old_default_results.bind(self).call(options)
            OsfProjects::allowed_project_topics(result, @user)
        end
    end

    TopicsController.class_eval do
        old_show = self.instance_method(:show)
        define_method(:show) do
            topic = Topic.with_deleted.where(id: params[:topic_id] || params[:id]).first
            if topic == nil
                slug = params[:slug] || params[:id]
                topic = Topic.find_by(slug: slug.downcase) if slug
            end
            raise Discourse::NotFound if topic == nil

            project_guid = topic.parent_guids[0]
            project_topic = OsfProjects::topic_for_guid(project_guid)
            raise Discourse::NotFound unless project_topic

            project_is_public = project_topic.project_is_public
            raise Discourse::NotFound unless project_is_public || OsfProjects::can_create_project_topic(project_guid, current_user)

            old_show.bind(self).call
        end
    end

    # Routing for the project specific end-points
    OsfProjects::Engine.routes.draw do
        get '/' => 'projects#index'
        constraints(project_guid: /[a-z0-9]+/) do
            get '/:project_guid' => 'projects#show'
            get '/c/:category/:project_guid' => 'projects#show'
            get '/c/:parent_category/:category/:project_guid' => 'projects#show'
            Discourse.filters.each do |filter|
              get "/:project_guid/l/#{filter}" => "projects#show_#{filter}"
              get "/c/:category/:project_guid/l/#{filter}" => "projects#show_#{filter}"
              get "/c/:parent_category/:category/:project_guid/l/#{filter}" => "projects#show_#{filter}"
            end
        end
    end

    Discourse::Application.routes.append do
      mount OsfProjects::Engine, at: "/projects"
    end

    class ::OsfProjects::ProjectsController < ::ApplicationController
        include ::TopicListResponder
        requires_plugin 'discourse-osf-projects'

        PAGE_SIZE = 50

        # Tries to make sure show can be called through an XHR?
        skip_before_filter :check_xhr, only: [:show]

        def index
            render json: { projects: [''] }
        end

        # [:latest, :unread, :new, :read, :posted, :bookmarks]
        Discourse.filters.each do |filter|
            define_method("show_#{filter}") do
                project_guid = OsfProjects::clean_guid(params[:project_guid])
                project_topic = OsfProjects::topic_for_guid(project_guid)
                project_is_public = project_topic.project_is_public

                raise Discourse::NotFound unless project_is_public || OsfProjects::can_create_project_topic(project_guid, current_user)

                parent_guids = [project_topic.parent_guids].flatten
                parent_names = OsfProjects::names_for_guids(parent_guids)

                list_options = {
                    per_page: PAGE_SIZE,
                    limit: true,
                }
                list_options.merge!(build_topic_list_options)
                query = TopicQuery.new(current_user, list_options)

                result = query.send("#{filter}_project_results", project_guid)

                options = {}
                if filter == :read || filter == :unread || filter == :new
                    options = {unordered: true}
                end

                list = query.create_list(filter, options, result)
                list.parent_guids = parent_guids
                list.parent_names = parent_names
                list.project_is_public = project_is_public

                respond_with_list(list)
            end
        end

        def show
          show_latest
        end

        def build_topic_list_options
          options = {
            page: params[:page],
            topic_ids: param_to_integer_list(:topic_ids),
            exclude_category_ids: params[:exclude_category_ids],
            category: params[:category],
            order: params[:order],
            ascending: params[:ascending],
            min_posts: params[:min_posts],
            max_posts: params[:max_posts],
            status: params[:status],
            filter: params[:filter],
            state: params[:state],
            search: params[:search],
            q: params[:q]
          }
          options[:no_subcategories] = true if params[:no_subcategories] == 'true'
          options[:slow_platform] = true if slow_platform?

          options
        end
    end
end
